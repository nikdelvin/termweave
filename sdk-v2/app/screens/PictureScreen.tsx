import { PixelRenderer } from '#termweave'
import campfireUri from '../assets/campfire.png' with { type: 'file' }
import { AppStatePanel } from '../components/AppStatePanel'

export function PictureScreen() {
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
          height={7}
          padding={2}
          border
          borderStyle="heavy"
          borderColor="#FFFFFF"
          flexDirection="column"
        >
          <text fg="#FFFFFF">PICTURE SCREEN · BUNDLED PNG</text>
          <text fg="#FFFFFF">The PNG is the animation's committed first frame.</text>
        </box>
        <AppStatePanel label="PICTURE SCREEN" />
      </box>
    </PixelRenderer>
  )
}
