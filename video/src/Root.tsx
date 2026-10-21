import { Composition } from 'remotion';
import { totalFrames, Tutorial } from './Tutorial';

export const RemotionRoot = () => (
  <Composition id="Tutorial" component={Tutorial} durationInFrames={totalFrames(30)} fps={30} width={1920} height={1080} />
);
