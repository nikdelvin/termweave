/** @jsxImportSource @opentui/react */
import type { SelectOption } from '@opentui/core'
import {
  SPACE_OBJECT_TYPES,
  getTermweaveConfig,
  spaceObjectPaletteNames,
} from '#termweave'
import type { SpaceGuiState } from './space'

export type SpaceConfigField = 'type' | 'palette' | 'randomize'

export const SPACE_CONFIG_FIELDS: readonly SpaceConfigField[] = ['type', 'palette', 'randomize']

const SELECTED_COLOR = '#F2D3AB'
const LABEL_COLOR = '#8a8a8a'

function label(value: string) {
  return value.replaceAll('-', ' ').toUpperCase()
}

function toOptions<T extends string>(values: readonly T[]): SelectOption[] {
  return values.map((value) => ({ name: label(value), description: '', value }))
}

const TYPE_OPTIONS = toOptions(SPACE_OBJECT_TYPES)

const TYPE_VISIBLE_ITEMS = 6
const PALETTE_VISIBLE_ITEMS = 5

export interface SpaceConfigPanelProps {
  config: SpaceGuiState
  onChange: (partial: Partial<SpaceGuiState>) => void
  onRandomize: () => void
  focusedField: SpaceConfigField
}

export function SpaceConfigPanel({ config, onChange, onRandomize, focusedField }: SpaceConfigPanelProps) {
  const themeColor = getTermweaveConfig().themeColor
  const paletteOptions = toOptions(spaceObjectPaletteNames(config.objectType))
  const typeIndex = Math.max(0, SPACE_OBJECT_TYPES.indexOf(config.objectType))
  const paletteIndex = Math.max(0, paletteOptions.findIndex((option) => option.value === config.palette))

  const selectProps = {
    width: '100%' as const,
    showDescription: false,
    backgroundColor: themeColor,
    textColor: '#c8c8c8',
    focusedBackgroundColor: '#101736',
    selectedBackgroundColor: SELECTED_COLOR,
    selectedTextColor: '#010416',
  }

  return (
    <box
      position="absolute"
      bottom={2}
      left={2}
      width={35}
      zIndex={3}
      backgroundColor={themeColor}
      border
      borderStyle="heavy"
      borderColor="#FFFFFF"
      title="SPACE CONFIG"
      titleColor="#FFFFFF"
      padding={1}
      flexDirection="column"
      gap={0}
    >
      <text fg={LABEL_COLOR}>TYPE</text>
      <select
        {...selectProps}
        height={TYPE_VISIBLE_ITEMS}
        options={TYPE_OPTIONS}
        selectedIndex={typeIndex}
        focused={focusedField === 'type'}
        onChange={(index) => {
          const objectType = TYPE_OPTIONS[index]?.value as SpaceGuiState['objectType'] | undefined
          if (!objectType || objectType === config.objectType) return
          onChange({ objectType, palette: spaceObjectPaletteNames(objectType)[0]! })
        }}
      />
      <text fg={LABEL_COLOR}>PALETTE</text>
      <select
        {...selectProps}
        height={PALETTE_VISIBLE_ITEMS}
        options={paletteOptions}
        selectedIndex={paletteIndex}
        focused={focusedField === 'palette'}
        onChange={(index) => {
          const palette = paletteOptions[index]?.value
          if (palette && palette !== config.palette) onChange({ palette })
        }}
      />
      <box
        focusable
        focused={focusedField === 'randomize'}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
        focusedBorderColor={SELECTED_COLOR}
        backgroundColor={themeColor}
        height={3}
        alignItems="center"
        justifyContent="center"
        zIndex={3}
        onKeyDown={(key) => {
          if (key.name === 'return') onRandomize()
        }}
      >
        <text fg={focusedField === 'randomize' ? SELECTED_COLOR : "#FFFFFF"}>RANDOMIZE</text>
      </box>
      <text fg={LABEL_COLOR}>TAB:NEXT·ARROWS:CHOOSE·ENTER:OK</text>
    </box>
  )
}
