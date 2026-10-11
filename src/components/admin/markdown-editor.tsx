'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useEffect, useRef, useState } from 'react'
import { markdownRequiresSource, safeContentUrl } from '@/lib/markdown'
import { MediaPicker } from './media-picker'

/** 未知结构锁定源码，标准结构使用官方Markdown扩展往返。 */
export default function MarkdownEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [sourceMode, setSourceMode] = useState(true)
  const [full, setFull] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const latest = useRef(value)
  const mode = useRef(sourceMode)
  const textarea = useRef<HTMLTextAreaElement>(null)
  latest.current = value
  mode.current = sourceMode
  const unsupported = markdownRequiresSource(value)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false } }),
      Markdown,
      Image,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: {
      attributes: { class: 'prose dark:prose-invert max-w-none min-h-96 p-5 focus:outline-none' },
    },
  })
  useEffect(() => {
    if (!sourceMode && editor && editor.getMarkdown() !== value)
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [value, editor, sourceMode])
  const insert = (text: string) => {
    setSourceMode(true)
    onChange(`${value}\n\n${text}`)
  }
  // 文件上传后仍由选择器确认描述，未明确选择前不修改正文。
  const uploadImages = (files: File[]) => {
    if (uploading) return
    setUploadError('')
    setPendingFiles(files)
    setPickerOpen(true)
  }
  return (
    <section
      className={`rounded-xl border ${full ? 'bg-background fixed inset-4 z-50 overflow-auto' : ''}`}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/'),
        )
        if (files.length) {
          event.preventDefault()
          void uploadImages(files)
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          file.type.startsWith('image/'),
        )
        if (files.length) {
          event.preventDefault()
          void uploadImages(files)
        }
      }}
    >
      <div className="bg-surface-subtle flex flex-wrap gap-2 border-b p-3 text-sm">
        <button type="button" disabled={uploading} onClick={() => setPickerOpen(true)}>
          从媒体库插入图片
        </button>
        <label className="cursor-pointer">
          {uploading ? '上传图片中…' : '上传图片'}
          <input
            type="file"
            aria-label="编辑器上传图片"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            disabled={uploading}
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void uploadImages(files)
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (sourceMode && editor && !unsupported)
              editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
            if (!sourceMode && editor) onChange(editor.getMarkdown())
            setSourceMode(!sourceMode)
          }}
          disabled={unsupported && sourceMode}
        >
          {sourceMode ? '所见即所得' : 'Markdown 源码'}
        </button>
        <button type="button" onClick={() => setFull(!full)}>
          {full ? '退出全屏' : '全屏'}
        </button>
        {!sourceMode && editor && (
          <>
            <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}>
              粗体
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}>
              斜体
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()}>
              删除线
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleCode().run()}>
              行内代码
            </button>
            {([2, 3, 4] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
              >
                H{level}
              </button>
            ))}
            <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>
              无序列表
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              有序列表
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleTaskList().run()}>
              任务列表
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
              引用
            </button>
            <button
              type="button"
              onClick={() => {
                const language = prompt('代码语言', 'typescript')
                if (language !== null) editor.chain().focus().toggleCodeBlock({ language }).run()
              }}
            >
              代码块
            </button>
            <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
              分割线
            </button>
            <button
              type="button"
              onClick={() => {
                const href = prompt('链接地址')
                if (href && safeContentUrl(href)) editor.chain().focus().setLink({ href }).run()
              }}
            >
              链接
            </button>
            <button
              type="button"
              onClick={() => {
                const src = prompt('图片地址')
                if (src && safeContentUrl(src)) {
                  const alt = prompt('图片描述（必填）')?.trim()
                  if (!alt) {
                    setUploadError('图片描述不能为空；已取消插入。')
                    return
                  }
                  editor.chain().focus().setImage({ src, alt }).run()
                }
              }}
            >
              图片
            </button>
            <button
              type="button"
              onClick={() =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
            >
              表格
            </button>
            <button type="button" onClick={() => editor.chain().focus().undo().run()}>
              撤销
            </button>
            <button type="button" onClick={() => editor.chain().focus().redo().run()}>
              重做
            </button>
          </>
        )}
        <select
          aria-label="插入自定义块"
          value=""
          onChange={(event) => {
            const type = event.target.value
            if (type)
              insert(
                type === 'video' || type === 'card'
                  ? `:::${type}[标题](https://example.com)\n::: `
                  : `:::${type}[标题]\n内容\n:::`,
              )
          }}
        >
          <option value="">插入自定义块</option>
          {['tip', 'warning', 'details', 'video', 'card'].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      {uploadError && (
        <p role="alert" className="text-destructive p-3 text-sm">
          {uploadError}
        </p>
      )}
      {unsupported && (
        <p className="text-muted-foreground border-b p-3 text-sm">
          正文包含扩展或未知结构，已保留完整源码；可直接编辑自定义块。
        </p>
      )}
      {sourceMode ? (
        <textarea
          ref={textarea}
          aria-label="正文"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-96 w-full resize-y bg-transparent p-5 font-mono text-sm leading-7 outline-none"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
      <MediaPicker
        open={pickerOpen}
        imagesOnly
        initialFiles={pendingFiles}
        onBusyChange={setUploading}
        onClose={() => {
          setPickerOpen(false)
          setPendingFiles([])
          setUploading(false)
        }}
        onSelect={(media) => {
          if (!mode.current && editor)
            editor
              .chain()
              .focus()
              .setImage({ src: media.url, alt: media.alt ?? '' })
              .run()
          else {
            const image = `![${(media.alt ?? media.originalName).replace(/[\\\[\]]/g, '\\$&')}](${media.url})`
            const next = `${latest.current}\n\n${image}`
            latest.current = next
            onChange(next)
          }
        }}
      />
    </section>
  )
}
