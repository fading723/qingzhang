const { withAndroidManifest, withDangerousMod, withAppDelegate } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const legacyRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="." />
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
</full-backup-content>
`;
const extractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </device-transfer>
</data-extraction-rules>
`;

const swiftSetup = `
    // Qingzhang: all persistent financial files live below this excluded directory.
    do {
      let manager = FileManager.default
      var directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Qingzhang", isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
    } catch {
      // Fail closed: do not start an app that cannot honor its local-only storage contract.
      fatalError("Cannot prepare Qingzhang local-only storage: \\(error)")
    }
`;

module.exports = function withLocalOnlyBackup(config) {
  config = withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android manifest has no application element.');
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/qingzhang_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/qingzhang_extraction_rules';
    return c;
  });
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const directory = path.join(
        c.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'qingzhang_backup_rules.xml'), legacyRules);
      fs.writeFileSync(path.join(directory, 'qingzhang_extraction_rules.xml'), extractionRules);
      return c;
    },
  ]);
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift')
      throw new Error('Qingzhang local-only storage requires the Expo Swift AppDelegate template.');
    if (c.modResults.contents.includes('// Qingzhang: all persistent financial files')) return c;
    const marker = /didFinishLaunchingWithOptions[\s\S]*?\)\s*->\s*Bool\s*\{/;
    if (!marker.test(c.modResults.contents))
      throw new Error('Could not locate AppDelegate startup; refusing to omit backup exclusion.');
    c.modResults.contents = c.modResults.contents.replace(
      marker,
      (matched) => matched + swiftSetup,
    );
    if (!/^import Foundation\s*$/m.test(c.modResults.contents))
      c.modResults.contents = `import Foundation\n${c.modResults.contents}`;
    return c;
  });
};
