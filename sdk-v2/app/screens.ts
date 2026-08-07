import { GalleryScreen } from './screens/GalleryScreen'
import { HomeScreen } from './screens/HomeScreen'
import { PlainScreen } from './screens/PlainScreen'

// Import screens above and register each one here. These keys are passed directly to navigate().
export const screens = {
  '/': HomeScreen,
  '/gallery': GalleryScreen,
  '/plain': PlainScreen,
}

export type ScreenKey = keyof typeof screens
