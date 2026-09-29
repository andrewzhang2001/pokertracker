import { mergeProfiles, renameProfile } from '../shared/api/profilesApi'

// Rename a profile. When another named profile already has that name, ask to
// merge into it instead; declining leaves everything unchanged. Resolves to the
// id the profile now lives under, or null when nothing changed.
export async function renameOrMerge(id: number, name: string): Promise<number | null> {
  const { duplicate } = await renameProfile(id, name)
  if (!duplicate) return id
  const clash = duplicate.find(p => !p.anonymous)
  if (!clash) {
    await renameProfile(id, name, true)
    return id
  }
  if (!confirm(`You already have a profile named "${clash.name}". Merge this one into it?`)) return null
  await mergeProfiles(id, clash.id)
  return clash.id
}
