import { AnimationScreen, animationScreenMediaUri } from './screens/AnimationScreen'
import { PictureScreen, pictureScreenMediaUri } from './screens/PictureScreen'
import { PlainScreen } from './screens/PlainScreen'

// Import screens above and register each one here. These keys are passed directly to navigate().
export const screens = {
  animation: AnimationScreen,
  picture: PictureScreen,
  plain: PlainScreen,
}

export type ScreenKey = keyof typeof screens

export const screenMedia: Partial<Record<ScreenKey, string>> = {
  animation: animationScreenMediaUri,
  picture: pictureScreenMediaUri,
}
