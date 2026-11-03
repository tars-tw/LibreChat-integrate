import { memo } from 'react';
import useTarsSourceLinks, { hasTarsSourcesKeyword } from '~/hooks/Tars/useTarsSourceLinks';
import { Text } from './Parts';

type SourcedTextProps = {
  text: string;
  showCursor: boolean;
  isCreatedByUser: boolean;
};

function LinkedText({ text, ...props }: SourcedTextProps) {
  const linked = useTarsSourceLinks(text);
  return <Text text={linked} {...props} />;
}

/**
 * A text part whose 資料來源 file names link to their downloads (Agent
 * 「參考資料下載」). Every other text renders as before, without reading the
 * conversation.
 */
const SourcedText = memo(function SourcedText(props: SourcedTextProps) {
  if (props.isCreatedByUser || !hasTarsSourcesKeyword(props.text)) {
    return <Text {...props} />;
  }
  return <LinkedText {...props} />;
});
SourcedText.displayName = 'SourcedText';

export default SourcedText;
