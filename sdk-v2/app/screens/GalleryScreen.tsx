import { PixelRenderer } from '#termweave'
import galleryUri from '../../app.icon.png' with { type: 'file' }
import { ScreenControls } from '../components/ScreenControls'

export function GalleryScreen() {
  return (
    <PixelRenderer uri={galleryUri} width="100%" height="100%">
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
          <text fg="#FFFFFF">GALLERY SCREEN · BUNDLED PNG</text>
          <text fg="#FFFFFF">This example deliberately reuses the application icon.</text>
        </box>
        <ScreenControls label="GALLERY SCREEN" />
      </box>
    </PixelRenderer>
  )
}
