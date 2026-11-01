import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { LedgerState } from '../../domain/types';
import { formatMoney } from '../../domain/money';
import { localDateTime } from '../../domain/time';
import {
  applyImport,
  createBackup,
  csvTemplate,
  exportCsv,
  importPreview,
  parseBackup,
} from '../../data/portable';
import { exportText, pickText, readSafetyBackup, saveSafetyBackup } from '../../services/files';
import { useLedger } from '../../store/LedgerProvider';
import { Button, Card, Choice, Hint, ModalSheet, SectionTitle } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { ItemRow, Label, useTask } from './common';

type Preview = ReturnType<typeof importPreview>;
const kindNames = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  refund: '退款',
  adjustment: '余额调整',
};
export function DataManagement() {
  const { state, mutate, notify } = useLedger();
  const { colors } = useTheme();
  const { run, working } = useTask();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicatesAccepted, setDuplicatesAccepted] = useState(false);
  const [restore, setRestore] = useState<LedgerState | null>(null);
  const [safetyPath, setSafetyPath] = useState('');
  const [backupConfirmation, setBackupConfirmation] = useState<string | null>(null);
  const stamp = () => localDateTime().replace(/[-:T]/g, '').slice(0, 12);
  const exportBackup = () =>
    run(async () => {
      const createdAt = new Date().toISOString();
      const snapshot: LedgerState = {
        ...state,
        settings: { ...state.settings, lastBackupAt: createdAt },
      };
      await exportText(`青账-完整备份-${stamp()}.json`, createBackup(snapshot), 'application/json');
      setBackupConfirmation(createdAt);
    });
  const chooseCsv = () =>
    run(async () => {
      const text = await pickText();
      if (text === null) return;
      setPreview(importPreview(text, state));
      setDuplicatesAccepted(false);
    });
  const chooseBackup = () =>
    run(async () => {
      const text = await pickText();
      if (text === null) return;
      setRestore(parseBackup(text));
    });
  const restoreBackup = () =>
    run(async () => {
      if (!restore) return;
      let previous = state;
      await mutate((current) => {
        previous = current;
        return current;
      });
      const path = await saveSafetyBackup(previous);
      await mutate((current) => {
        if (current !== previous) throw new Error('账本刚刚发生变化，请重新确认恢复');
        return restore;
      });
      setRestore(null);
      setSafetyPath(path);
      notify('账本已恢复，恢复前的账本已留存一份副本');
    });
  const problemCount = preview
    ? preview.errors.length + preview.rows.filter((r) => r.errors.length > 0).length
    : 0;
  const duplicateCount = preview?.rows.filter((r) => r.duplicate).length || 0;
  const displayRows = preview
    ? [
        ...preview.rows.filter((r) => r.errors.length > 0),
        ...preview.rows.filter((r) => !r.errors.length && r.duplicate),
        ...preview.rows.filter((r) => !r.errors.length && !r.duplicate),
      ].slice(0, 40)
    : [];
  return (
    <>
      <Card tint>
        <ItemRow
          icon="shield-checkmark-outline"
          title="你的账本，由你保管"
          subtitle={`${state.transactions.length} 笔流水 · ${state.accounts.length} 个账户`}
        />
        <Hint>
          最近备份：
          {state.settings.lastBackupAt
            ? localDateTime(state.settings.lastBackupAt).replace('T', ' ')
            : '尚未创建备份'}
        </Hint>
        <Button
          label="导出完整备份"
          icon="download-outline"
          loading={working}
          onPress={exportBackup}
        />
      </Card>
      <SectionTitle title="备份与换机" />
      <Card>
        <ItemRow
          icon="archive-outline"
          title="从完整备份恢复"
          subtitle="恢复账户、分类、流水、预算与周期账单"
          onPress={() => !working && chooseBackup()}
        />
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 9 }} />
        <ItemRow
          icon="arrow-undo-outline"
          title="找回恢复前的账本"
          subtitle="上次覆盖恢复前，会先留存本地副本"
          onPress={() =>
            !working &&
            run(async () => {
              const text = await readSafetyBackup();
              if (!text) throw new Error('还没有恢复前的本地副本');
              setRestore(parseBackup(text));
            })
          }
        />
      </Card>
      <Hint>
        完整备份是可在苹果和安卓间使用的 JSON
        文件，内容未加密，请保存在自己信任的位置。恢复会覆盖当前账本；确认前会先自动保留当前账本副本。
      </Hint>
      {safetyPath ? (
        <Card>
          <ItemRow
            icon="checkmark-circle-outline"
            title="已保留恢复前的账本"
            subtitle="可通过“找回恢复前的账本”重新打开。"
          />
        </Card>
      ) : null}
      <SectionTitle title="流水导入与导出" />
      <Card>
        <ItemRow
          icon="document-text-outline"
          title="导出流水 CSV"
          subtitle="包含收入、支出、转账、退款和余额调整"
          onPress={() =>
            !working &&
            run(async () => {
              await exportText(`青账-流水-${stamp()}.csv`, exportCsv(state), 'text/csv');
              notify('已打开导出，请完成保存');
            })
          }
        />
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 9 }} />
        <ItemRow
          icon="cloud-upload-outline"
          title="导入流水 CSV"
          subtitle="先检查和预览，确认后再写入账本"
          onPress={() => !working && chooseCsv()}
        />
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 9 }} />
        <ItemRow
          icon="document-attach-outline"
          title="下载导入模板"
          subtitle="使用当前账本的账户和分类生成示例"
          onPress={() =>
            !working &&
            run(async () => {
              await exportText('青账-流水导入模板.csv', csvTemplate(state), 'text/csv');
              notify('已打开导出，请完成保存；填写实际金额后再导入');
            })
          }
        />
      </Card>
      <Hint>
        CSV
        只迁移流水，预算和周期账单请使用完整备份。首版支持青账模板，不直接识别银行、微信或支付宝原始账单。请保留模板表头，并将示例金额和时间替换为自己的记录。
      </Hint>
      {Platform.OS === 'web' && (
        <Hint>
          浏览器预览数据保存在当前浏览器中。清理浏览器数据前请导出完整备份；手机 App
          的账本与此独立。
        </Hint>
      )}
      <ModalSheet
        visible={!!backupConfirmation}
        onClose={() => !working && setBackupConfirmation(null)}
        title="备份文件保存好了？"
      >
        <Hint>请确认已在文件或分享界面保存好这份备份。确认后，青账才会更新最近备份时间。</Hint>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          <Button
            label="还未保存"
            variant="secondary"
            disabled={working}
            onPress={() => setBackupConfirmation(null)}
          />
          <Button
            label="已保存，完成备份"
            loading={working}
            onPress={() =>
              run(async () => {
                if (!backupConfirmation) return;
                await mutate((s) => ({
                  ...s,
                  settings: { ...s.settings, lastBackupAt: backupConfirmation },
                }));
                setBackupConfirmation(null);
                notify('完整备份已确认保存');
              })
            }
          />
        </View>
      </ModalSheet>
      <ModalSheet
        visible={!!preview}
        onClose={() => !working && setPreview(null)}
        title="检查导入流水"
      >
        <Hint>
          {preview?.rows.length || 0} 行流水 · {problemCount} 项需修正 · {duplicateCount} 行可能重复
        </Hint>
        {preview?.errors.map((error, index) => (
          <Text key={index} style={{ color: colors.danger, marginBottom: 8, lineHeight: 21 }}>
            {error}
          </Text>
        ))}
        {displayRows.map((row) => (
          <View
            key={row.row}
            style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>
                第 {row.row} 行 ·{' '}
                {row.transaction?.note ||
                  (row.transaction ? kindNames[row.transaction.kind] : '无法识别')}
              </Text>
              {row.transaction && Number.isSafeInteger(row.transaction.amountCents) && (
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  ¥{formatMoney(row.transaction.amountCents)}
                </Text>
              )}
            </View>
            {row.transaction && (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>
                {kindNames[row.transaction.kind]} ·{' '}
                {localDateTime(row.transaction.occurredAt).replace('T', ' ')} ·{' '}
                {state.accounts.find((a) => a.id === row.transaction?.accountId)?.name}
              </Text>
            )}
            {row.duplicate && (
              <Text style={{ color: colors.expense, fontSize: 12, marginTop: 5 }}>
                发现相同标识或相似流水，请核对
              </Text>
            )}
            {row.errors.map((error, index) => (
              <Text
                key={index}
                style={{ color: colors.danger, fontSize: 12, lineHeight: 19, marginTop: 4 }}
              >
                {error}
              </Text>
            ))}
          </View>
        ))}
        {(preview?.rows.length || 0) > 40 && (
          <Hint>优先展示有错误或疑似重复的记录，最多 40 行；所有行均已完成校验。</Hint>
        )}
        {duplicateCount > 0 && !problemCount && (
          <View style={{ marginVertical: 13 }}>
            <Choice
              label="我已核对，相似记录需要保留"
              active={duplicatesAccepted}
              onPress={() => setDuplicatesAccepted(!duplicatesAccepted)}
            />
          </View>
        )}
        {problemCount > 0 && <Hint>请修正文件后重新导入。此次预览没有改变你的账本。</Hint>}
        <View style={{ marginTop: 15 }}>
          <Button
            label="确认导入"
            icon="checkmark"
            loading={working}
            disabled={
              !preview?.rows.length ||
              problemCount > 0 ||
              (duplicateCount > 0 && !duplicatesAccepted)
            }
            onPress={() =>
              run(async () => {
                if (!preview) return;
                await mutate((s) => applyImport(s, preview));
                const count = preview.rows.length;
                setPreview(null);
                notify(`已导入 ${count} 笔流水`);
              })
            }
          />
        </View>
      </ModalSheet>
      <ModalSheet
        visible={!!restore}
        onClose={() => !working && setRestore(null)}
        title="确认恢复账本"
      >
        <Card tint>
          <Label>这份备份包含</Label>
          <Text style={{ color: colors.text, fontSize: 19, lineHeight: 30, fontWeight: '700' }}>
            {restore?.transactions.length || 0} 笔流水 · {restore?.accounts.length || 0} 个账户
          </Text>
          <Hint>
            {restore?.categories.length || 0} 个分类 · {restore?.budgets.length || 0} 项预算 ·{' '}
            {restore?.recurringRules.length || 0} 项周期账单
          </Hint>
        </Card>
        <Hint>
          当前的 {state.transactions.length}{' '}
          笔流水会被整份替换，不会合并。恢复前先保留当前账本的本地副本；文件校验或写入失败时，当前账本保持完整。
        </Hint>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button
            label="取消"
            variant="secondary"
            disabled={working}
            onPress={() => setRestore(null)}
          />
          <Button
            label="备份当前并恢复"
            variant="danger"
            loading={working}
            onPress={restoreBackup}
          />
        </View>
      </ModalSheet>
    </>
  );
}
