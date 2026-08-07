import { getAppConfig } from '../../shared/config'
import { ScreenControls } from '../components/ScreenControls'

export function PlainScreen() {
  const config = getAppConfig()
  const panelWidth = Math.min(72, config.terminalGrid.cols - 8)

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      backgroundColor={config.backgroundColor}
    >
      <box
        width={panelWidth}
        height={14}
        flexDirection="column"
        border
        borderStyle="heavy"
        borderColor={config.foregroundColor}
        padding={2}
      >
        <text fg={config.foregroundColor}>PLAIN SCREEN · NO PIXELRENDERER</text>
        <text fg={config.foregroundColor}>
          Ordinary Solid/OpenTUI content with no native media drawing.
        </text>
      </box>
      <ScreenControls label="PLAIN SCREEN" />
    </box>
  )
}
