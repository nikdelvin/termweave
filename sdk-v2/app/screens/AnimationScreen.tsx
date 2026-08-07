import { PixelRenderer } from '#termweave'
import campfireUri from '../assets/campfire.gif' with { type: 'file' }
import { AppStatePanel } from '../components/AppStatePanel'

export function AnimationScreen() {
  return (
    <PixelRenderer uri={campfireUri} width="100%" height="100%">
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
      >
        <box
          width={72}
          height={8}
          padding={2}
          border
          borderStyle="heavy"
          borderColor="#FFFFFF"
          flexDirection="column"
        >
          <text fg="#FFFFFF">ANIMATION SCREEN · BUNDLED GIF</text>
          <text fg="#FFFFFF">A bundled GIF rendered behind ordinary OpenTUI layout.</text>
          <text fg="#FFFFFF">UP/DOWN: CHANGE SCREEN</text>
        </box>
        <AppStatePanel label="ANIMATION SCREEN" />
      </box>
    </PixelRenderer>
  )
}
