import { createStore } from 'solid-js/store'
import { createScreenNavigation } from '#termweave'
import type { ScreenKey } from './screens'

export interface AppState {
  readonly inputText: string
}

type MutableAppState = {
  -readonly [Key in keyof AppState]: AppState[Key]
}

const INITIAL_APP_STATE: MutableAppState = Object.freeze({
  inputText: '',
})

const [appStore, setAppState] = createStore<MutableAppState>(INITIAL_APP_STATE)

export const appState: Readonly<AppState> = appStore
export const { navigate, screen } = createScreenNavigation<ScreenKey>('animation')

export function setInputText(value: string) {
  setAppState('inputText', value)
}

export function resetAppState() {
  setAppState({ ...INITIAL_APP_STATE })
}
