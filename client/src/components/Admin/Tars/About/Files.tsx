import { Download } from 'lucide-react';
import { SBOM_FILES } from './helpers';

/** Downloadable files attached to the release: the SBOM for each build artifact. */
export default function Files() {
  return (
    <ul className="space-y-1.5">
      {SBOM_FILES.map((file) => (
        <li key={file.key}>
          <a
            href={`/sbom/${file.filename}`}
            download={file.filename}
            className="flex w-fit items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            <Download className="size-3.5 shrink-0" aria-hidden />
            {file.filename}
          </a>
        </li>
      ))}
    </ul>
  );
}
