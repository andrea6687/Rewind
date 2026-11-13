import { mock } from 'bun:test'
import { atom, describe, expect, hostMock, read, test, update } from './host'

mock.module('claude-code', () => ({ atom, read, update }))
mock.module('claude-code/testing', () => ({ describe, expect, mock: hostMock, test }))
