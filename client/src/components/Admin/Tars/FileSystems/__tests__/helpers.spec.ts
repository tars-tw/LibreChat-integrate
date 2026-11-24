import {
  hasSmbShare,
  toFileRows,
  folderOptions,
  missingFolder,
  groupPathLabel,
  listsNfsExports,
  listsSmbShares,
  discoverFolders,
  fileServerTestPath,
  folderWithinTested,
  buildFullFolderPath,
  childFolders,
  breadcrumbOf,
  groupPathBlocker,
} from '../helpers';

/** What pwc_tars' test_connection answered for the demo servers, trimmed. */
const SMB_SHARES = ['A$', 'ADMIN$', 'C$', 'NETLOGON', 'SharedFolder', 'SYSVOL'];
const SMB_AT_SHARE = ['ESG提案.pdf', 'SMB測試/人資部/2024/專案說明.txt', 'SMB測試/財務部/明細.csv'];
/** Tested at `SharedFolder/SMB測試`: still relative to the share root. */
const SMB_AT_SUBFOLDER = ['SMB測試/人資部/2024/專案說明.txt', 'SMB測試/財務部/明細.csv'];
const FTP_AT_ROOT = ['test2/demo_ftp.txt', 'test2/test_ftp_05.txt', 'demo_ftp.txt'];
const SFTP_AT_ROOT = ['upload/sample_sftp.doc', 'upload/docs/a.md'];
const SFTP_AT_UPLOAD = ['/upload/sample_sftp.doc', '/upload/docs/a.md'];

describe('fileServerTestPath', () => {
  it('tests `/` until a folder is picked and normalises SMB backslashes', () => {
    expect(fileServerTestPath('FTP', '  ')).toBe('/');
    expect(fileServerTestPath('SMB', '\\SharedFolder\\sub')).toBe('/SharedFolder/sub');
    expect(fileServerTestPath('FTP', 'a\\b')).toBe('a\\b');
  });
});

describe('groupPathLabel', () => {
  it("shows every protocol's stored path the same way", () => {
    expect(groupPathLabel('SharedFolder')).toBe('/SharedFolder');
    expect(groupPathLabel('\\SharedFolder\\SMB測試\\')).toBe('/SharedFolder/SMB測試');
    expect(groupPathLabel('/mnt/data/nfs_data/')).toBe('/mnt/data/nfs_data');
    expect(groupPathLabel('/')).toBe('/');
    expect(groupPathLabel('')).toBe('/');
    expect(groupPathLabel(null)).toBe('/');
  });
});

describe('missingFolder', () => {
  it('requires an SMB share, as pwc_tars refuses to save without one', () => {
    expect(missingFolder({ protocol: 'SMB', path: '' })).toBe(true);
    expect(missingFolder({ protocol: 'SMB', path: '/' })).toBe(true);
    expect(missingFolder({ protocol: 'SMB', path: '/SharedFolder' })).toBe(false);
    expect(hasSmbShare('SharedFolder')).toBe(true);
  });

  it('requires an NFS export but lets FTP and SFTP save the root', () => {
    expect(missingFolder({ protocol: 'NFS', path: '' })).toBe(true);
    expect(missingFolder({ protocol: 'NFS', path: '/' })).toBe(false);
    expect(missingFolder({ protocol: 'FTP', path: '' })).toBe(false);
    expect(missingFolder({ protocol: 'SFTP', path: '' })).toBe(false);
  });
});

describe('listsNfsExports', () => {
  it('asks for the export list only while no NFS export is picked', () => {
    expect(listsNfsExports({ protocol: 'NFS', path: '' })).toBe(true);
    expect(listsNfsExports({ protocol: 'NFS', path: '/mnt/data' })).toBe(false);
    expect(listsNfsExports({ protocol: 'SMB', path: '' })).toBe(false);
  });
});

describe('buildFullFolderPath', () => {
  it('keeps the leading slash under the root, which FTP sync needs', () => {
    expect(buildFullFolderPath('/', 'test2')).toBe('/test2');
    expect(buildFullFolderPath('/', '')).toBe('/');
    expect(buildFullFolderPath('SharedFolder/', 'sub')).toBe('SharedFolder/sub');
  });
});

describe('SMB', () => {
  it('treats the answer at `/` as shares, not files', () => {
    expect(listsSmbShares('SMB', '/')).toBe(true);
    expect(toFileRows('SMB', '/', SMB_SHARES)).toEqual([]);
    expect(folderOptions('SMB', '/', SMB_SHARES)).toEqual([
      '/',
      '/A$',
      '/ADMIN$',
      '/C$',
      '/NETLOGON',
      '/SharedFolder',
      '/SYSVOL',
    ]);
  });

  it('lists the folders of a share under the share', () => {
    expect(folderOptions('SMB', '/SharedFolder', SMB_AT_SHARE)).toEqual([
      '/',
      '/SharedFolder',
      '/SharedFolder/SMB測試',
      '/SharedFolder/SMB測試/人資部',
      '/SharedFolder/SMB測試/人資部/2024',
      '/SharedFolder/SMB測試/財務部',
    ]);
  });

  it('strips the sub-path SMB repeats below the share instead of doubling it', () => {
    const options = folderOptions('SMB', 'SharedFolder/SMB測試', SMB_AT_SUBFOLDER);
    expect(options).toEqual([
      '/',
      '/SharedFolder',
      'SharedFolder/SMB測試',
      'SharedFolder/SMB測試/人資部',
      'SharedFolder/SMB測試/人資部/2024',
      'SharedFolder/SMB測試/財務部',
    ]);
    expect(toFileRows('SMB', 'SharedFolder/SMB測試', SMB_AT_SUBFOLDER)[0]).toEqual({
      name: '專案說明.txt',
      directory: '人資部/2024',
    });
  });
});

describe('FTP', () => {
  it('builds absolute folders from paths reported relative to the tested one', () => {
    expect(folderOptions('FTP', '/', FTP_AT_ROOT)).toEqual(['/', '/test2']);
    expect(folderOptions('FTP', '/test2', ['demo_ftp.txt', 'sub/a.txt'])).toEqual([
      '/',
      '/test2',
      '/test2/sub',
    ]);
  });
});

describe('SFTP', () => {
  it('strips the tested path SFTP prefixes onto every file', () => {
    expect(folderOptions('SFTP', '/', SFTP_AT_ROOT)).toEqual(['/', '/upload', '/upload/docs']);
    expect(folderOptions('SFTP', '/upload', SFTP_AT_UPLOAD)).toEqual([
      '/',
      '/upload',
      '/upload/docs',
    ]);
    expect(toFileRows('SFTP', '/upload', SFTP_AT_UPLOAD)).toEqual([
      { name: 'sample_sftp.doc', directory: '' },
      { name: 'a.md', directory: 'docs' },
    ]);
  });
});

describe('NFS', () => {
  it('offers the exports, and only folders inside one', () => {
    expect(folderOptions('NFS', '/', [], ['/mnt/data', '/srv/share'])).toEqual([
      '/mnt/data',
      '/srv/share',
    ]);
    expect(folderOptions('NFS', '/mnt/data', ['reports/q1.pdf'], ['/mnt/data'])).toEqual([
      '/mnt/data',
      '/mnt/data/reports',
    ]);
  });

  it('keeps the tested folder and below when the server will not list exports', () => {
    expect(folderOptions('NFS', '/mnt/data', ['reports/q1.pdf'])).toEqual([
      '/mnt/data',
      '/mnt/data/reports',
    ]);
  });
});

describe('childFolders', () => {
  it('keeps only the folders directly inside the one on screen', () => {
    const folders = [
      '/',
      '/SharedFolder',
      '/SharedFolder/A',
      '/SharedFolder/A/2024',
      '/SharedFolder/B',
    ];
    expect(childFolders(folders, '/SharedFolder')).toEqual(['/SharedFolder/A', '/SharedFolder/B']);
    expect(childFolders(folders, '/')).toEqual(['/SharedFolder']);
    expect(childFolders(folders, '/SharedFolder/B')).toEqual([]);
  });

  it('lists SMB shares as the folders of the server root', () => {
    expect(childFolders(folderOptions('SMB', '/', SMB_SHARES), '/')).toContain('/SharedFolder');
  });
});

describe('breadcrumbOf', () => {
  it('walks from the root down to the folder on screen', () => {
    expect(breadcrumbOf('/SharedFolder/SMB測試/')).toEqual([
      { name: '/', path: '/' },
      { name: 'SharedFolder', path: '/SharedFolder' },
      { name: 'SMB測試', path: '/SharedFolder/SMB測試' },
    ]);
    expect(breadcrumbOf('/')).toEqual([{ name: '/', path: '/' }]);
  });
});

describe('groupPathBlocker', () => {
  it('needs a share on SMB and an export on NFS; anywhere is fine for FTP and SFTP', () => {
    expect(groupPathBlocker('SMB', '/', false)).toBe('smb_share');
    expect(groupPathBlocker('SMB', '/SharedFolder', false)).toBeNull();
    expect(groupPathBlocker('NFS', '/', false)).toBe('nfs_export');
    expect(groupPathBlocker('NFS', '/mnt/data', true)).toBe('nfs_export');
    expect(groupPathBlocker('NFS', '/mnt/data/nfs_data', false)).toBeNull();
    expect(groupPathBlocker('FTP', '/', false)).toBeNull();
    expect(groupPathBlocker('SFTP', '/', false)).toBeNull();
  });
});

describe('folderWithinTested', () => {
  it('places a picked folder relative to the tested one, or outside it', () => {
    expect(folderWithinTested('SFTP', '/', '/upload/docs')).toBe('upload/docs');
    expect(folderWithinTested('SMB', 'SharedFolder', 'SharedFolder')).toBe('');
    expect(folderWithinTested('FTP', '/test2', '/')).toBeNull();
  });
});

describe('discoverFolders', () => {
  it('lists every folder along the way, for the knowledge-base import dialog', () => {
    expect(discoverFolders(['a/b/c.txt', '/d/e.txt', 'x\\y.txt', 'skip/'])).toEqual([
      'a',
      'a/b',
      'd',
      'x',
    ]);
  });
});
