import { UserStore } from '../../../store';
import { currentSettings } from './settings';

const generalConfig = (s: UserStore) => currentSettings(s).general || {};

const neutralColor = (s: UserStore) => generalConfig(s).neutralColor;
const primaryColor = (s: UserStore) => generalConfig(s).primaryColor;
const fontSize = (s: UserStore) => generalConfig(s).fontSize;
const highlighterTheme = (s: UserStore) => generalConfig(s).highlighterTheme;
const mermaidTheme = (s: UserStore) => generalConfig(s).mermaidTheme;
const transitionMode = (s: UserStore) => generalConfig(s).transitionMode;
const animationMode = (s: UserStore) => generalConfig(s).animationMode;
const generalInstruction = (s: UserStore) => generalConfig(s).generalInstruction;

export const userGeneralSettingsSelectors = {
  animationMode,
  config: generalConfig,
  fontSize,
  generalInstruction,
  highlighterTheme,
  mermaidTheme,
  neutralColor,
  primaryColor,
  transitionMode,
};
