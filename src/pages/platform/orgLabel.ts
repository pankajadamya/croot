/**
 * Organisation names are not unique, so wherever an admin picks or sees an organisation it is shown
 * with its owner's email: "Balance & Beyond (owner: kam@example.com)".
 */
export interface OrgWithOwners {
  name: string
  ownerEmails?: string[]
}

export function ownerText(o: OrgWithOwners): string {
  const owners = o.ownerEmails ?? []
  if (!owners.length) return 'no owner'
  return `owner: ${owners[0]}${owners.length > 1 ? ` +${owners.length - 1}` : ''}`
}

export function orgLabel(o: OrgWithOwners): string {
  return `${o.name} (${ownerText(o)})`
}
