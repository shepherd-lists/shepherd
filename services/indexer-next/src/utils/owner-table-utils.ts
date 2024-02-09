/** we can't use `-` in postgres table names, and usual starting character rules */
export const ownerToTablename = (owner: string) => `owner_${owner.replace(/-/g, '·')}`
export const tablenameToOwner = (owner: string) => owner.slice('owner_'.length).replace(/·/g, '-')

