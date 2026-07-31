import { getAppConfig } from '../shared/config'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing application root')

const config = getAppConfig()
document.title = config.name
root.textContent = config.name
