import { AppStatePanel } from '../components/AppStatePanel'

export const remoteVideoScreenMediaUri =
  'https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4'

export function RemoteVideoScreen() {
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
        <text fg="#FFFFFF">REMOTE VIDEO · 1080P H.264 + AAC</text>
        <text fg="#FFFFFF">Sintel trailer · Blender Foundation · CC BY</text>
        <text fg="#FFFFFF">LEFT/RIGHT: CHANGE SCREEN</text>
      </box>
      <AppStatePanel />
    </box>
  )
}
