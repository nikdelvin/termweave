/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import { getTermweaveConfig } from '#termweave'
import { SpaceScreen, type SpaceGuiState } from './space'
import {
  PIXEL_RENDERER_ERROR_BACKGROUND_COLOR,
  PIXEL_RENDERER_ERROR_FOREGROUND_COLOR,
} from '../termweave/constants'

function nextSeed() {
  return Math.floor(Math.random() * 2147483647)
}

function createInitialSpaceConfig(): SpaceGuiState {
  return {
    objectType: 'terran-wet',
    palette: 'earth',
    objectSeed: nextSeed(),
    backgroundSeed: nextSeed(),
  }
}

function randomizeSpaceFields(): Partial<SpaceGuiState> {
  return {
    objectSeed: nextSeed(),
    backgroundSeed: nextSeed(),
  }
}

export function App() {
  const themeColor = getTermweaveConfig().themeColor
  const [spaceConfig, setSpaceConfig] = useState<SpaceGuiState>(createInitialSpaceConfig)
  const [rendererError, setRendererError] = useState('')

  useEffect(() => {
    setRendererError('')
  }, [spaceConfig])

  return (
    <box width="100%" height="100%" flexDirection="column">
      <SpaceScreen
        spaceConfig={spaceConfig}
        onSpaceConfigChange={(partial) => setSpaceConfig((config) => ({ ...config, ...partial }))}
        onRandomize={() => setSpaceConfig((config) => ({ ...config, ...randomizeSpaceFields() }))}
        onRendererError={setRendererError}
      />
      <box
        position="absolute"
        bottom={2}
        right={2}
        width={35}
        height={21}
        zIndex={3}
        backgroundColor={themeColor}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
        title="TERMWEAVE"
        titleColor="#FFFFFF"
        padding={1}
        flexDirection="column"
        gap={1}
      >
        <text fg="#c8c8c8">📟 React in, CRT app out</text>
        <text fg="#c8c8c8">📺 A real CRT, no filter</text>
        <text fg="#c8c8c8">🖼️ Pixel-art backdrops</text>
        <text fg="#c8c8c8">🧊 three.js in the tube</text>
        <text fg="#c8c8c8">🪐 Whole galaxy as example</text>
        <text fg="#c8c8c8">🎨 All colors → RGB332</text>
        <text fg="#c8c8c8">⚡️ One command → .app + .dmg</text>
        <text fg="#c8c8c8">✨ You bring the vibes</text>
        <text fg="#c8c8c8">🖥️ We bring the machine</text>
      </box>
      {rendererError !== '' && (
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          minHeight={3}
          padding={1}
          backgroundColor={PIXEL_RENDERER_ERROR_BACKGROUND_COLOR}
          zIndex={20}
        >
          <text fg={PIXEL_RENDERER_ERROR_FOREGROUND_COLOR}>ThreeRenderer: {rendererError}</text>
        </box>
      )}
    </box>
  )
}
