/** @jsxImportSource @opentui/react */
import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import { SpaceObject, type SpaceObjectType } from '#termweave'
import { SpaceConfigPanel, SPACE_CONFIG_FIELDS, type SpaceConfigField } from './space-panel'

export interface SpaceGuiState {
  objectType: SpaceObjectType
  palette: string
  objectSeed: number
  backgroundSeed: number
}

export interface SpaceScreenProps {
  spaceConfig: SpaceGuiState
  onSpaceConfigChange: (partial: Partial<SpaceGuiState>) => void
  onRandomize: () => void
  onRendererError?: (message: string) => void
}

export function SpaceScreen({ spaceConfig, onSpaceConfigChange, onRandomize, onRendererError }: SpaceScreenProps) {
  const [focusedField, setFocusedField] = useState<SpaceConfigField>('type')

  useKeyboard((key) => {
    if (key.name !== 'tab' || key.ctrl || key.meta || key.hyper || key.super) return
    const current = SPACE_CONFIG_FIELDS.indexOf(focusedField)
    const delta = key.shift ? -1 : 1
    setFocusedField(
      SPACE_CONFIG_FIELDS[(current + delta + SPACE_CONFIG_FIELDS.length) % SPACE_CONFIG_FIELDS.length]!,
    )
  })

  return (
    <box width="100%" height="100%">
      <SpaceObject
        object={{
          type: spaceConfig.objectType,
          seed: spaceConfig.objectSeed,
          palette: spaceConfig.palette,
        }}
        backgroundSeed={spaceConfig.backgroundSeed}
        onError={onRendererError}
      />

      <SpaceConfigPanel
        config={spaceConfig}
        onChange={onSpaceConfigChange}
        onRandomize={onRandomize}
        focusedField={focusedField}
      />
    </box>
  )
}
