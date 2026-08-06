import { type InputRenderable, type KeyEvent } from '@opentui/core'
import { createSignal, onMount } from 'solid-js'
import { getTermweaveConfig } from '#termweave'
import { GALLERY_SCREEN, HOME_SCREEN, PLAIN_SCREEN, type ScreenId } from '../screen-state'

const screenInputIds: Record<ScreenId, string> = {
  [HOME_SCREEN]: 'home-input',
  [GALLERY_SCREEN]: 'gallery-input',
  [PLAIN_SCREEN]: 'plain-input',
}

export const screenInputId = (screen: ScreenId) => screenInputIds[screen]

type ScreenControlsProps = {
  label: string
  screen: ScreenId
}

type HorizontalKey = Pick<
  KeyEvent,
  'ctrl' | 'hyper' | 'meta' | 'name' | 'option' | 'sequence' | 'shift' | 'super'
>

function horizontalDelta(key: HorizontalKey) {
  if (key.ctrl || key.hyper || key.meta || key.option || key.shift || key.super) return 0
  if (key.name === 'left' && ['\u001b[D', '\u001bOD'].includes(key.sequence)) return -1
  if (key.name === 'right' && ['\u001b[C', '\u001bOC'].includes(key.sequence)) return 1
  return 0
}

export function ScreenControls(props: ScreenControlsProps) {
  let input: InputRenderable | undefined
  const config = getTermweaveConfig()
  const panelWidth = Math.min(72, config.terminalGrid.cols - 8)
  const panelLeft = Math.floor((config.terminalGrid.cols - panelWidth) / 2)
  const panelTop = Math.floor(config.terminalGrid.rows / 2) + 9
  const [count, setCount] = createSignal(0)
  const [draft, setDraft] = createSignal('')

  onMount(() => input?.focus())

  const onKeyDown = (key: KeyEvent) => {
    const delta = horizontalDelta(key)
    if (delta === 0) return
    key.preventDefault()
    setCount((value) => value + delta)
  }

  return (
    <box
      position="absolute"
      top={panelTop}
      left={panelLeft}
      width={panelWidth}
      height={9}
      padding={1}
      border
      borderStyle="rounded"
      borderColor="#FFFFFF"
      backgroundColor={config.backgroundColor}
      flexDirection="column"
      zIndex={3}
    >
      <text height={1} fg="#FFFFFF" content={`${props.label} · SCREEN: ${props.screen}`} />
      <text height={1} fg="#FFFFFF" content="UP: PREVIOUS · DOWN: NEXT · TAB: INPUT ONLY" />
      <text height={1} fg="#FFFFFF" content="USE LEFT / RIGHT ARROWS TO CHANGE" />
      <text height={1} fg="#FFFFFF" content={`VALUE: ${count()}`} />
      <input
        id={screenInputId(props.screen)}
        ref={input}
        width={panelWidth - 4}
        value={draft()}
        placeholder="TYPE HERE"
        onInput={setDraft}
        onKeyDown={onKeyDown}
      />
      <text height={1} fg="#FFFFFF" content={`TYPED: ${draft()}`} />
    </box>
  )
}
