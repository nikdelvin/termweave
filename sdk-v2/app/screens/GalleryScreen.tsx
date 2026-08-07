import { PixelRenderer } from '#termweave'
import { getAppConfig } from '../../shared/config'
import galleryUri from '../assets/gallery.png' with { type: 'file' }
import { ScreenControls } from '../components/ScreenControls'

export function GalleryScreen() {
  const config = getAppConfig()

  return (
    <PixelRenderer uri={galleryUri} width="100%" height="100%">
      <box
        position="absolute"
        top={3}
        left={6}
        width={config.terminalGrid.cols - 12}
        height={config.terminalGrid.rows - 6}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
      />
      <text position="absolute" top={5} left={8} fg="#FFFFFF">
        GALLERY SCREEN · BUNDLED PNG
      </text>
      <ScreenControls label="GALLERY SCREEN" />
    </PixelRenderer>
  )
}
