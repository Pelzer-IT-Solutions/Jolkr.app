/**
 * The three right-click / add menus that the ChannelSidebar shows:
 *
 *   1. Add / empty-space menu — "New Folder", "New Text/Voice Channel"
 *   2. Channel menu — settings, rename, archive, delete
 *   3. Folder menu — create channel inside, rename, delete
 *
 * Owns no state of its own. Open/closed status is driven entirely by the
 * three position-objects (or `null`) coming from the parent ChannelSidebar.
 */
import { FolderPlus, Hash, Volume2, Trash2, Archive, Edit3, Settings } from 'lucide-react'
import type { ChannelDisplay, CategoryDisplay } from '../../types'
import { Menu, MenuItem, MenuDivider } from '../Menu'

export type CreatingState =
  | { type: 'folder' }
  | { type: 'channel'; kind: 'text' | 'voice'; categoryId?: string }

interface Props {
  // Add / empty-space menu
  addMenu: { x: number; y: number } | null
  onAddMenuClose: () => void

  // Channel right-click menu
  channelMenu: { x: number; y: number; channelId: string } | null
  onChannelMenuClose: () => void
  channelMap: Record<string, ChannelDisplay>

  // Folder right-click menu
  folderMenu: { x: number; y: number; categoryId: string } | null
  onFolderMenuClose: () => void
  localCats: CategoryDisplay[]
  serverCategories: CategoryDisplay[]

  // Shared actions
  onStartCreating: (state: CreatingState) => void
  onStartChannelRename: (channel: ChannelDisplay) => void
  onStartCategoryRename: (cat: CategoryDisplay) => void
  setCollapsedCats: React.Dispatch<React.SetStateAction<Set<string>>>

  // Permissions / pass-through handlers
  canManageChannels?: boolean
  onArchiveChannel?: (channelId: string) => Promise<void>
  onDeleteChannel?: (channelId: string) => Promise<void>
  onOpenChannelSettings?: (channelId: string) => void
  onCreateChannel?: (name: string, kind: 'text' | 'voice', categoryId?: string) => Promise<void>
  onDeleteCategory?: (categoryId: string) => Promise<void>
}

export function ChannelContextMenu({
  addMenu, onAddMenuClose,
  channelMenu, onChannelMenuClose, channelMap,
  folderMenu, onFolderMenuClose, localCats, serverCategories,
  onStartCreating, onStartChannelRename, onStartCategoryRename, setCollapsedCats,
  canManageChannels, onArchiveChannel, onDeleteChannel, onOpenChannelSettings,
  onCreateChannel, onDeleteCategory,
}: Props) {
  return (
    <>
      {/* ── Add / empty-space menu ── */}
      <Menu open={addMenu !== null} position={addMenu ?? { x: 0, y: 0 }} onClose={onAddMenuClose}>
        <MenuItem icon={<FolderPlus size={13} strokeWidth={1.5} />} label="New Folder" onClick={() => onStartCreating({ type: 'folder' })} />
        <MenuItem icon={<Hash size={13} strokeWidth={1.5} />} label="New Text Channel" onClick={() => onStartCreating({ type: 'channel', kind: 'text' })} />
        <MenuItem icon={<Volume2 size={13} strokeWidth={1.5} />} label="New Voice Channel" onClick={() => onStartCreating({ type: 'channel', kind: 'voice' })} />
      </Menu>

      {/* ── Channel context menu ── */}
      <Menu open={channelMenu !== null} position={channelMenu ?? { x: 0, y: 0 }} onClose={onChannelMenuClose}>
        {onOpenChannelSettings && channelMenu && (
          <MenuItem
            icon={<Settings size={13} strokeWidth={1.5} />}
            label="Channel Settings"
            onClick={() => {
              onOpenChannelSettings(channelMenu.channelId)
              onChannelMenuClose()
            }}
          />
        )}
        {canManageChannels && channelMenu && (
          <MenuItem
            icon={<Edit3 size={13} strokeWidth={1.5} />}
            label="Rename Channel"
            onClick={() => {
              const channel = channelMap[channelMenu.channelId]
              if (channel) onStartChannelRename(channel)
              onChannelMenuClose()
            }}
          />
        )}
        {onArchiveChannel && channelMenu && (
          <MenuItem
            icon={<Archive size={13} strokeWidth={1.5} />}
            label="Archive Channel"
            onClick={() => {
              onArchiveChannel(channelMenu.channelId)
              onChannelMenuClose()
            }}
          />
        )}
        {onDeleteChannel && channelMenu && (
          <>
            <MenuDivider />
            <MenuItem
              icon={<Trash2 size={13} strokeWidth={1.5} />}
              label="Delete Channel"
              danger
              onClick={() => {
                if (window.confirm('Delete this channel? This cannot be undone.')) {
                  onDeleteChannel(channelMenu.channelId)
                }
                onChannelMenuClose()
              }}
            />
          </>
        )}
      </Menu>

      {/* ── Category/folder context menu ── */}
      <Menu open={folderMenu !== null} position={folderMenu ?? { x: 0, y: 0 }} onClose={onFolderMenuClose}>
        {canManageChannels && folderMenu && onCreateChannel && (() => {
          const category = localCats.find(c => c.name === folderMenu.categoryId)
          if (!category) return null
          const startInFolder = (kind: 'text' | 'voice') => {
            // Make sure the folder is expanded so the inline input is visible
            setCollapsedCats(prev => {
              if (!prev.has(category.name)) return prev
              const next = new Set(prev)
              next.delete(category.name)
              return next
            })
            onStartCreating({ type: 'channel', kind, categoryId: category.id })
          }
          return (
            <>
              <MenuItem
                icon={<Hash size={13} strokeWidth={1.5} />}
                label="Create Text Channel"
                onClick={() => startInFolder('text')}
              />
              <MenuItem
                icon={<Volume2 size={13} strokeWidth={1.5} />}
                label="Create Voice Channel"
                onClick={() => startInFolder('voice')}
              />
            </>
          )
        })()}
        {canManageChannels && folderMenu && (
          <MenuItem
            icon={<Edit3 size={13} strokeWidth={1.5} />}
            label="Rename Folder"
            onClick={() => {
              const category = localCats.find(c => c.name === folderMenu.categoryId)
              if (category) onStartCategoryRename(category)
              onFolderMenuClose()
            }}
          />
        )}
        {onDeleteCategory && folderMenu && (
          <>
            <MenuDivider />
            <MenuItem
              icon={<Trash2 size={13} strokeWidth={1.5} />}
              label="Delete Folder"
              danger
              onClick={() => {
                if (window.confirm('Delete this folder? Channels inside will not be deleted.')) {
                  const category = localCats.find(c => c.name === folderMenu.categoryId)
                  if (category) {
                    const serverCat = serverCategories.find(c => c.name === category.name)
                    if (serverCat) onDeleteCategory(serverCat.name)
                  }
                }
                onFolderMenuClose()
              }}
            />
          </>
        )}
      </Menu>
    </>
  )
}
