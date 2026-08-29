import type { Component } from 'solid-js'
import campfireGifUri from './assets/campfire.gif' with { type: 'file' }
import campfirePngUri from './assets/campfire.png' with { type: 'file' }
import { AppStatePanel } from './AppStatePanel'

interface ScreenDefinition {
  readonly component: Component
  readonly mediaUri?: string
}

interface DemoScreenProps {
  readonly description: string
  readonly title: string
}

function DemoScreen(props: DemoScreenProps) {
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
        <text fg="#FFFFFF">{props.title}</text>
        <text fg="#FFFFFF">{props.description}</text>
        <text fg="#FFFFFF">LEFT/RIGHT: CHANGE SCREEN</text>
      </box>
      <AppStatePanel />
    </box>
  )
}

export const screens = {
  animation: {
    component: () => (
      <DemoScreen
        title="ANIMATION SCREEN · BUNDLED GIF"
        description="A bundled GIF rendered behind ordinary OpenTUI layout."
      />
    ),
    mediaUri: campfireGifUri,
  },
  picture: {
    component: () => (
      <DemoScreen
        title="PICTURE SCREEN · BUNDLED PNG"
        description="The PNG is the animation's committed first frame."
      />
    ),
    mediaUri: campfirePngUri,
  },
  video: {
    component: () => (
      <DemoScreen
        title="REMOTE VIDEO · 1080P H.264 + AAC"
        description="Sintel trailer · Blender Foundation · CC BY"
      />
    ),
    mediaUri: 'https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4',
  },
} satisfies Record<string, ScreenDefinition>

export type ScreenKey = keyof typeof screens
