import { Directory, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** In a standalone iOS app the config plugin creates and excludes this directory before JS starts. */
export function privateDirectory(): Directory {
  const standaloneIos =
    Platform.OS === 'ios' && !Paths.document.uri.includes('ExponentExperienceData');
  const directory = standaloneIos
    ? new Directory(Paths.document.parentDirectory, 'Library', 'Application Support', 'Qingzhang')
    : new Directory(Paths.document, 'Qingzhang');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}
