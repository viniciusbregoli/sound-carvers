import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { useVideoConfig } from 'remotion';
import { Board, Details, Homework, Intro, Live, Outro, Parts, Phone, QuickAdd, Rating, SetlistsScene, SignIn, StageMode } from './scenes';

/** Seconds each scene shows, and the crossfade between them. */
export const SCENES = [4.5, 7, 8, 6.5, 7, 6, 10, 5, 9, 9, 7, 5, 6];
export const FADE = 15;
export const totalFrames = (fps: number) => SCENES.reduce((sum, s) => sum + Math.round(s * fps), 0) - FADE * (SCENES.length - 1);

/** A short tour of the Sound Carvers app for the band (pt-BR). */
export const Tutorial = () => {
  const { fps } = useVideoConfig();
  const cut = <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />;
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Abertura" durationInFrames={4.5 * fps}><Intro /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Entrar" durationInFrames={7 * fps}><SignIn /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Quadro" durationInFrames={8 * fps}><Board /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Adicionar" durationInFrames={6.5 * fps}><QuickAdd /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Detalhes" durationInFrames={7 * fps}><Details /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Quem faz o quê" durationInFrames={6 * fps}><Parts /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Avaliação" durationInFrames={10 * fps}><Rating /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Dever de casa" durationInFrames={5 * fps}><Homework /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Setlists" durationInFrames={9 * fps}><SetlistsScene /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Modo palco" durationInFrames={9 * fps}><StageMode /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Celular" durationInFrames={7 * fps}><Phone /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Banda" durationInFrames={5 * fps}><Live /></TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="Encerramento" durationInFrames={6 * fps}><Outro /></TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
