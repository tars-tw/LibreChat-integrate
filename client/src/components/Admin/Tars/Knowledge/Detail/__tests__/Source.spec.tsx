import React from 'react';
import { render, screen } from '@testing-library/react';
import SourceIcon, { sourceLabel } from '../Source';

const mockLocalize = (key: string) => key;

jest.mock('~/hooks', () => ({
  useLocalize: () => mockLocalize,
}));

describe('SourceIcon', () => {
  it('keeps a manual upload in the plain text color', () => {
    render(<SourceIcon source="manual" />);

    expect(screen.getByRole('img', { name: 'com_ui_tars_kb_ds_source_manual' })).toHaveClass(
      'text-text-primary',
    );
  });

  it.each([
    ['ftp', 'FTP', 'text-series-1'],
    ['sftp', 'SFTP', 'text-series-2'],
    ['smb', 'SMB', 'text-series-3'],
    ['nfs', 'NFS', 'text-series-4'],
    ['server', 'SERVER', 'text-series-6'],
  ])('gives %s its own color', (source, name, color) => {
    render(<SourceIcon source={source} />);

    expect(screen.getByRole('img', { name })).toHaveClass(color);
  });

  it('names the source in a tooltip, however pwc_tars cased it', () => {
    render(<SourceIcon source=" Ftp " />);

    expect(screen.getByTitle('FTP')).toBeInTheDocument();
  });

  it('still marks a source it has no icon for', () => {
    render(<SourceIcon source="s3" />);

    expect(screen.getByRole('img', { name: 'S3' })).toHaveClass('text-text-secondary');
  });

  it('renames only a manual upload, without touching the stored value', () => {
    expect(sourceLabel(' manual ', mockLocalize)).toBe('com_ui_tars_kb_ds_source_manual');
    expect(sourceLabel('MANUAL', mockLocalize)).toBe('com_ui_tars_kb_ds_source_manual');
    expect(sourceLabel('sftp', mockLocalize)).toBe('SFTP');
  });

  it.each([[null], [undefined], [''], ['  ']])('shows a dash for %p', (source) => {
    render(<SourceIcon source={source} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
