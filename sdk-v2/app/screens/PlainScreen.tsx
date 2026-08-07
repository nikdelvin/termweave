import { getTermweaveConfig } from '#termweave'
import { ScreenControls } from '../components/ScreenControls'

export function PlainScreen() {
  const config = getTermweaveConfig()

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      backgroundColor={config.themeColor}
    >
      <box
        width={72}
        height={14}
        flexDirection="column"
        border
        borderStyle="heavy"
        borderColor={config.terminalForegroundColor}
        padding={2}
      >
        <text fg={config.terminalForegroundColor}>PLAIN SCREEN · NO PIXELRENDERER</text>
        <text fg={config.terminalForegroundColor}>
          Ordinary Solid/OpenTUI content with no native media drawing.
        </text>
      </box>
      <ScreenControls label="PLAIN SCREEN" />
    </box>
  )
}
