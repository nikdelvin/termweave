import campfireUri from '../assets/campfire.gif' with { type: 'file' }
import { AppStatePanel } from '../components/AppStatePanel'

export const animationScreenMediaUri = campfireUri

export function AnimationScreen() {
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
        <text fg="#FFFFFF">ANIMATION SCREEN · BUNDLED GIF</text>
        <text fg="#FFFFFF">A bundled GIF rendered behind ordinary OpenTUI layout.</text>
        <text fg="#FFFFFF">LEFT/RIGHT: CHANGE SCREEN</text>
      </box>
      <AppStatePanel />
    </box>
  )
}
