import { useLocalize } from '~/hooks';

function TarsBrandPanel() {
  const localize = useLocalize();

  return (
    <div className="hidden w-2/5 flex-col items-center justify-center bg-[#ff9f00] p-10 md:flex">
      <img
        src="assets/tars/login_page_6.png"
        alt=""
        className="mb-8 w-full max-w-[320px] object-contain"
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
