import { AnimationScreen, animationScreenMediaUri } from './screens/AnimationScreen'
import { PictureScreen, pictureScreenMediaUri } from './screens/PictureScreen'
import { RemoteVideoScreen, remoteVideoScreenMediaUri } from './screens/RemoteVideoScreen'

// Import screens above and register each one here. These keys are passed directly to navigate().
export const screens = {
  animation: AnimationScreen,
  picture: PictureScreen,
  video: RemoteVideoScreen,
}

export type ScreenKey = keyof typeof screens

export const screenMedia: Partial<Record<ScreenKey, string>> = {
  animation: animationScreenMediaUri,
  picture: pictureScreenMediaUri,
  video: remoteVideoScreenMediaUri,
}
