import { ulid } from 'ulid';
import { refPrefix } from '@mm/integration';

/** Mint a cross-app reference: `<prefix>_<ULID>`. Minted once, never re-pointed. */
export function mintRef(kind: keyof typeof refPrefix): string {
	return `${refPrefix[kind]}_${ulid()}`;
}
