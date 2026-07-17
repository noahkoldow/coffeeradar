import React from 'react';

type Props = {
  ad: any | null;
  onClose: () => void;
  deckColors?: { bg: string; text: string };
};

/** Web fallback — AdMob has no web SDK, so the video ad modal is never shown. */
export const VideoAdModal: React.FC<Props> = () => null;

export default VideoAdModal;
