import { useState } from 'react';
import { useLocalize } from '~/hooks';

const BRAND_IMAGE_COUNT = 6;

function TarsBrandPanel() {
  const localize = useLocalize();
  const [imageNumber] = useState(() => Math.floor(Math.random() * BRAND_IMAGE_COUNT) + 1);

  return (
    <div className="bg-pwc-success hidden w-2/5 flex-col items-center justify-center p-10 md:flex">
      <img
        src={`assets/tars/login_page_${imageNumber}.png`}
        alt=""
        className="mb-5 w-full max-w-[300px] object-contain"
      />
      <div className="max-w-md text-center">
        <div className="mb-3 text-2xl font-bold text-gray-900">
          {localize('com_auth_tars_tagline')}
        </div>
        <div className="text-sm font-light text-gray-800">
          {localize('com_auth_tars_tagline_desc')}
        </div>
      </div>
    </div>
  );
}

export default TarsBrandPanel;
