import campfireUri from '../assets/campfire.png' with { type: 'file' }
import { AppStatePanel } from '../components/AppStatePanel'

export const pictureScreenMediaUri = campfireUri

export function PictureScreen() {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="space-between"
      alignItems="center"
    >
      <box
        width={72}
        height={9}
        padding={1}
        gap={1}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
        flexDirection="column"
      >
        <text fg="#FFFFFF">PICTURE SCREEN · BUNDLED PNG</text>
        <text fg="#FFFFFF">The PNG is the animation's committed first frame.</text>
        <text fg="#FFFFFF">LEFT/RIGHT: CHANGE SCREEN</text>
      </box>
      <AppStatePanel />
    </box>
  )
}
