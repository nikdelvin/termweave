import { type InputRenderable } from '@opentui/core'
import { onMount } from 'solid-js'
import { getTermweaveConfig } from '#termweave'
import { appState, screen, setInputText } from '../store'
import type { ScreenKey } from '../screens'

export const appStateInputId = (screenKey: ScreenKey) => `app-state-input:${screenKey}`

export function AppStatePanel() {
  let input: InputRenderable | undefined
  const config = getTermweaveConfig()
  const panelWidth = 72

  onMount(() => input?.focus())

  return (
    <box
      width={panelWidth}
      height={7}
      padding={1}
      gap={1}
      border
      borderStyle="heavy"
      borderColor="#FFFFFF"
      backgroundColor={config.themeColor}
      flexDirection="column"
      zIndex={3}
    >
      <text height={1} fg="#FFFFFF" content={`SCREEN ID: ${screen()}`} />
      <input
        id={appStateInputId(screen())}
        ref={input}
        width={panelWidth - 4}
        value={appState.inputText}
        placeholder="TYPE HERE"
        onInput={setInputText}
      />
    </box>
  )
}
