import { createSignal } from 'solid-js'
import { useKeyboard } from '@opentui/solid'

export function App() {
  const [count, setCount] = createSignal(0)

  useKeyboard((key) => {
    if (key.name === 'left') setCount((value) => value - 1)
    if (key.name === 'right') setCount((value) => value + 1)
    if (key.name === 'r') setCount(0)
  })

  return (
    <box
      width="100%"
      height="100%"
      backgroundColor="#0B1020"
      alignItems="center"
      justifyContent="center"
    >
      <box
        border
        title="TERMWEAVE"
        width={52}
        height={9}
        padding={1}
        gap={2}
        flexDirection="column"
        alignItems="center"
      >
        <text fg="#E6EDF7">Your OpenTUI application is ready.</text>
        <text fg="#E6EDF7">[&lt;] {count()} [&gt;]</text>
        <text fg="#E6EDF7">Left/Right changes value | R resets</text>
      </box>
    </box>
  )
}
