import { getTermweaveConfig } from '#termweave'
import { AppStatePanel } from '../components/AppStatePanel'

export function PlainScreen() {
  const config = getTermweaveConfig()

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="space-between"
      alignItems="center"
      backgroundColor={config.themeColor}
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
        <text fg="#FFFFFF">PLAIN SCREEN · NO PIXEL RENDERER</text>
        <text fg="#FFFFFF">Ordinary Solid/OpenTUI content with no native media drawing.</text>
        <text fg="#FFFFFF">LEFT/RIGHT: CHANGE SCREEN</text>
      </box>
      <AppStatePanel />
    </box>
  )
}
