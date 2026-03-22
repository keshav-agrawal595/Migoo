import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { MainComposition, CompositionProps } from './Composition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MainVideo"
        component={MainComposition as any}
        fps={30}
        width={720}
        height={1280} // 9:16 aspect ratio for shorts
        calculateMetadata={({ props }) => {
          return {
            durationInFrames: (props as any).durationInFrames || 300,
          };
        }}
        defaultProps={{
          imageUrls: [],
          avatarClipData: [],
          audioUrl: '',
          musicUrl: '',
          captionData: {
            segments: [],
          },
          durationInFrames: 300,
          captionStyle: 'bold-pop',
          language: 'en-IN',
        } as CompositionProps}
      />
    </>
  );
};

registerRoot(RemotionRoot);

