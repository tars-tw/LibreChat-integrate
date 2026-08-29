import { atom } from 'recoil';

/**
 * Shared state for the 記憶資料管理 dialog, the single upload surface in TARS
 * mode. Drag-drop and every upload button open the one dialog through these
 * atoms and stage their files on it; nothing is sent until the parse options
 * (image recognition, transcription model) are settled inside the dialog.
 */
const tarsMemoryDialogOpen = atom<boolean>({
  key: 'tarsMemoryDialogOpen',
  default: false,
});

const tarsMemoryStagedFiles = atom<File[]>({
  key: 'tarsMemoryStagedFiles',
  default: [],
});

export default {
  tarsMemoryDialogOpen,
  tarsMemoryStagedFiles,
};
