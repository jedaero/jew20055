import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { endBefore, get, limitToLast, orderByKey, push, query, ref, serverTimestamp, set, update } from 'firebase/database'
import { auth, database, firebaseReady, ownerUid } from './firebase'
import { compressPhoto, formatKB } from './image'
import './style.css'

const PHOTO_PAGE = 12
const QNA_PAGE = 10
const QUESTION_COOLDOWN_MS = 60_000
const COOLDOWN_KEY = 'deu-qna-last-sent'

function explainError(error) {
  const code = error?.code || ''
  if (code.includes('permission-denied') || code === 'PERMISSION_DENIED') return '권한이 없어 저장하지 못했습니다. 관리자 계정인지, database.rules.json이 게시됐는지 확인해 주세요.'
  if (code === 'auth/popup-blocked') return '로그인 창이 차단됐습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.'
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '로그인을 취소했습니다.'
  if (code === 'auth/unauthorized-domain') return '이 주소가 Firebase 승인 도메인에 없습니다. Firebase Console → Authentication → 설정 → 승인된 도메인에 추가해 주세요.'
  return error?.message || '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
}

const formatDate = timestamp => (timestamp ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(new Date(timestamp)) : '')
const toList = snapshot => Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => (a.id < b.id ? 1 : -1))

// Push key는 시간순이므로 key 순서로 최신 항목부터 끊어서 읽습니다.
async function readPage(path, size, beforeKey) {
  const constraints = beforeKey ? [orderByKey(), endBefore(beforeKey), limitToLast(size)] : [orderByKey(), limitToLast(size)]
  const items = toList(await get(query(ref(database, path), ...constraints)))
  return { items, hasMore: items.length === size }
}

function useOwner() {
  const [user, setUser] = useState(null)
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), [])
  return { user, isOwner: Boolean(user && user.uid === ownerUid) }
}

function Notice({ children, tone = 'info' }) {
  return children ? <p className={`notice ${tone}`} role="status">{children}</p> : null
}

function PhotoUploader({ onUploaded }) {
  const [draft, setDraft] = useState(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState({ text: '', tone: 'info' })
  const inputRef = useRef(null)

  const choose = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy('compress')
    setMessage({ text: '사진을 이 기기에서 줄이는 중입니다…', tone: 'info' })
    try {
      const result = await compressPhoto(file)
      setDraft(result)
      setMessage({ text: `원본 ${formatKB(result.originalBytes)} → 저장 ${formatKB(result.bytes)} (${result.full.width}×${result.full.height}px)`, tone: 'info' })
    } catch (error) {
      setDraft(null)
      setMessage({ text: explainError(error), tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const upload = async event => {
    event.preventDefault()
    if (!draft) return
    setBusy('upload')
    try {
      const id = push(ref(database, 'gallery/meta')).key
      await update(ref(database), {
        [`gallery/meta/${id}`]: { caption: caption.trim().slice(0, 200), createdAt: serverTimestamp(), width: draft.full.width, height: draft.full.height, bytes: draft.bytes },
        [`gallery/thumbs/${id}`]: draft.thumb.dataUrl,
        [`gallery/full/${id}`]: draft.full.dataUrl,
      })
      setDraft(null)
      setCaption('')
      setMessage({ text: '사진을 올렸습니다.', tone: 'success' })
      onUploaded()
    } catch (error) {
      setMessage({ text: explainError(error), tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  return <form className="uploader" onSubmit={upload}>
    <div className="uploader-preview">
      {draft ? <img src={draft.full.dataUrl} alt="압축된 사진 미리보기"/> : <button type="button" className="pick" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>
        <b>{busy === 'compress' ? '사진 줄이는 중…' : '＋ 사진 선택'}</b>
        <span>JPG · PNG · WebP, 원본 25MB 이하</span>
      </button>}
      <input ref={inputRef} type="file" accept="image/*" onChange={choose} hidden/>
    </div>
    <div className="uploader-fields">
      <label>사진 설명
        <input value={caption} maxLength={200} onChange={e => setCaption(e.target.value)} placeholder="예: 2026년 가을 현장 실습"/>
      </label>
      <div className="row">
        <button className="btn btn-dark" type="submit" disabled={!draft || Boolean(busy)}>{busy === 'upload' ? '올리는 중…' : '사진 올리기'}</button>
        {draft && <button className="btn btn-line" type="button" onClick={() => { setDraft(null); setMessage({ text: '', tone: 'info' }) }} disabled={Boolean(busy)}>다시 선택</button>}
      </div>
      <Notice tone={message.tone}>{message.text}</Notice>
      <p className="hint">사진은 긴 변 1024px, 약 100KB 이하로 줄여서 저장합니다. 목록에는 15KB 정도의 작은 썸네일만 불러옵니다.</p>
    </div>
  </form>
}

function Gallery({ isOwner }) {
  const [photos, setPhotos] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState(null)
  const fullCache = useRef(new Map())

  const loadThumbs = async items => {
    const entries = await Promise.all(items.map(async item => [item.id, (await get(ref(database, `gallery/thumbs/${item.id}`))).val()]))
    setThumbs(current => ({ ...current, ...Object.fromEntries(entries) }))
  }

  const load = async (more = false) => {
    setLoading(true)
    setError('')
    try {
      const page = await readPage('gallery/meta', PHOTO_PAGE, more ? photos.at(-1)?.id : undefined)
      setPhotos(current => (more ? [...current, ...page.items] : page.items))
      setHasMore(page.hasMore)
      await loadThumbs(page.items)
    } catch (err) {
      setError(explainError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const open = async photo => {
    setViewer({ photo, src: fullCache.current.get(photo.id) || thumbs[photo.id] })
    if (fullCache.current.has(photo.id)) return
    try {
      const src = (await get(ref(database, `gallery/full/${photo.id}`))).val()
      if (!src) return
      fullCache.current.set(photo.id, src)
      setViewer(current => (current?.photo.id === photo.id ? { photo, src } : current))
    } catch { /* 썸네일로 계속 보여줍니다 */ }
  }

  const remove = async photo => {
    if (!window.confirm('이 사진을 삭제할까요? 되돌릴 수 없습니다.')) return
    try {
      await update(ref(database), { [`gallery/meta/${photo.id}`]: null, [`gallery/thumbs/${photo.id}`]: null, [`gallery/full/${photo.id}`]: null })
      setPhotos(current => current.filter(item => item.id !== photo.id))
      setViewer(null)
    } catch (err) {
      setError(explainError(err))
    }
  }

  useEffect(() => {
    if (!viewer) return undefined
    const close = event => event.key === 'Escape' && setViewer(null)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [viewer])

  const usedChars = photos.reduce((sum, photo) => sum + (photo.bytes || 0), 0)

  return <section className="block" id="photos">
    <div className="blockhead">
      <div><div className="kicker">PHOTO ALBUM</div><h2>학과 사진첩</h2></div>
      <p>수업과 행사, 함께한 순간을 기록합니다. 사진을 누르면 크게 볼 수 있습니다.</p>
    </div>
    {isOwner && <PhotoUploader onUploaded={() => load()}/>}
    <Notice tone="error">{error}</Notice>
    {photos.length ? <div className="photos">
      {photos.map(photo => <figure key={photo.id} className="photo">
        <button type="button" className="open" onClick={() => open(photo)} aria-label={`${photo.caption || '사진'} 크게 보기`}>
          {thumbs[photo.id] ? <img src={thumbs[photo.id]} alt={photo.caption || '학과 사진'} loading="lazy"/> : <span className="placeholder"/>}
        </button>
        <figcaption><b>{photo.caption || '사진'}</b><span>{formatDate(photo.createdAt)}</span></figcaption>
        {isOwner && <button type="button" className="mini danger" onClick={() => remove(photo)}>삭제</button>}
      </figure>)}
    </div> : !loading && <p className="empty">아직 올라온 사진이 없습니다.</p>}
    <div className="more">
      {loading && <span className="muted">불러오는 중…</span>}
      {!loading && hasMore && <button className="btn btn-line" onClick={() => load(true)}>사진 더 보기</button>}
      {isOwner && photos.length > 0 && <span className="muted">불러온 {photos.length}장 저장량 약 {formatKB(usedChars)}</span>}
    </div>
    {viewer && <div className="viewer" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={() => setViewer(null)}>
      <figure onClick={event => event.stopPropagation()}>
        <img src={viewer.src} alt={viewer.photo.caption || '학과 사진'}/>
        <figcaption>{viewer.photo.caption} <span>{formatDate(viewer.photo.createdAt)}</span></figcaption>
      </figure>
      <button className="close" type="button" aria-label="닫기" onClick={() => setViewer(null)}>×</button>
    </div>}
  </section>
}

function QuestionForm({ onSent }) {
  const [name, setName] = useState('')
  const [question, setQuestion] = useState('')
  const [website, setWebsite] = useState('') // 자동 등록 프로그램을 거르는 숨은 칸
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: '', tone: 'info' })

  const submit = async event => {
    event.preventDefault()
    if (website) return
    let last = 0
    try { last = Number(localStorage.getItem(COOLDOWN_KEY)) || 0 } catch { /* 저장소를 쓸 수 없으면 건너뜁니다 */ }
    const wait = Math.ceil((last + QUESTION_COOLDOWN_MS - Date.now()) / 1000)
    if (wait > 0) { setMessage({ text: `${wait}초 뒤에 다시 질문할 수 있습니다.`, tone: 'error' }); return }
    setBusy(true)
    try {
      await set(push(ref(database, 'qna')), { name: name.trim().slice(0, 30), question: question.trim().slice(0, 500), createdAt: serverTimestamp() })
      try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())) } catch { /* 무시 */ }
      setQuestion('')
      setMessage({ text: '질문이 등록됐습니다. 답변이 달리면 이 페이지에 공개됩니다.', tone: 'success' })
      onSent()
    } catch (error) {
      setMessage({ text: explainError(error), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return <form className="ask" onSubmit={submit}>
    <label><span>이름 또는 별명 <small>(선택)</small></span>
      <input value={name} maxLength={30} onChange={e => setName(e.target.value)} placeholder="예: 입학 희망자"/>
    </label>
    <label>질문
      <textarea value={question} maxLength={500} minLength={2} required onChange={e => setQuestion(e.target.value)} placeholder="입학, 수업, 학교생활 등 궁금한 점을 적어 주세요."/>
    </label>
    <input className="trap" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} aria-hidden="true"/>
    <div className="row between">
      <span className="muted">{question.length}/500 · 질문과 답변은 모두에게 공개됩니다. 연락처 등 개인정보는 적지 마세요.</span>
      <button className="btn btn-dark" type="submit" disabled={busy || question.trim().length < 2}>{busy ? '등록 중…' : '질문 등록'}</button>
    </div>
    <Notice tone={message.tone}>{message.text}</Notice>
  </form>
}

function AnswerEditor({ item, onSaved }) {
  const [text, setText] = useState(item.answer || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const answer = text.trim().slice(0, 2000)
      const changes = answer ? { answer, answeredAt: serverTimestamp() } : { answer: null, answeredAt: null }
      await update(ref(database, `qna/${item.id}`), changes)
      onSaved()
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  return <form className="answer-editor" onSubmit={save}>
    <textarea value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder="답변을 작성하세요 (비워서 저장하면 답변이 지워집니다)"/>
    <button className="btn btn-dark" type="submit" disabled={busy || text.trim() === (item.answer || '')}>{busy ? '저장 중…' : item.answer ? '답변 수정' : '답변 등록'}</button>
    <Notice tone="error">{error}</Notice>
  </form>
}

function QnA({ isOwner }) {
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)

  const load = async (more = false) => {
    setLoading(true)
    setError('')
    try {
      const page = await readPage('qna', QNA_PAGE, more ? items.at(-1)?.id : undefined)
      setItems(current => (more ? [...current, ...page.items] : page.items))
      setHasMore(page.hasMore)
    } catch (err) {
      setError(explainError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const remove = async item => {
    if (!window.confirm('이 질문을 삭제할까요?')) return
    try {
      await set(ref(database, `qna/${item.id}`), null)
      setItems(current => current.filter(other => other.id !== item.id))
    } catch (err) {
      setError(explainError(err))
    }
  }

  const reloadOne = async id => {
    const value = (await get(ref(database, `qna/${id}`))).val()
    setItems(current => current.map(item => (item.id === id ? { id, ...value } : item)))
  }

  const shown = isOwner && pendingOnly ? items.filter(item => !item.answer) : items

  return <section className="block" id="qna">
    <div className="blockhead">
      <div><div className="kicker">QUESTIONS &amp; ANSWERS</div><h2>질문과 답변</h2></div>
      <p>학과와 입학, 수업에 대해 궁금한 점을 남겨 주세요. 담당 교수가 직접 답변합니다.</p>
    </div>
    <QuestionForm onSent={() => load()}/>
    <Notice tone="error">{error}</Notice>
    {isOwner && <label className="filter-toggle"><input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)}/> 답변 대기 질문만 보기</label>}
    {shown.length ? <ol className="qna-list">
      {shown.map(item => <li key={item.id} className="qna-item">
        <div className="q"><span className="tag">Q</span><div><p>{item.question}</p><small>{item.name || '익명'} · {formatDate(item.createdAt)}</small></div></div>
        {item.answer
          ? <div className="a"><span className="tag lime">A</span><div><p>{item.answer}</p><small>제승욱 교수 · {formatDate(item.answeredAt)}</small></div></div>
          : <div className="waiting">답변을 준비하고 있습니다.</div>}
        {isOwner && <div className="owner-tools">
          <AnswerEditor key={item.answer || ''} item={item} onSaved={() => reloadOne(item.id)}/>
          <button type="button" className="mini danger" onClick={() => remove(item)}>질문 삭제</button>
        </div>}
      </li>)}
    </ol> : !loading && <p className="empty">{pendingOnly ? '답변을 기다리는 질문이 없습니다.' : '아직 등록된 질문이 없습니다. 첫 질문을 남겨 주세요.'}</p>}
    <div className="more">
      {loading && <span className="muted">불러오는 중…</span>}
      {!loading && hasMore && <button className="btn btn-line" onClick={() => load(true)}>이전 질문 더 보기</button>}
    </div>
  </section>
}

function OwnerBar({ user, isOwner }) {
  const [error, setError] = useState('')
  const login = async () => {
    setError('')
    try { await signInWithPopup(auth, new GoogleAuthProvider()) } catch (err) { setError(explainError(err)) }
  }
  return <div className="ownerbar">
    {isOwner && <span>관리자로 로그인했습니다. 사진 올리기와 답변 작성을 할 수 있습니다.</span>}
    {user && !isOwner && <span>관리자 계정이 아닙니다 ({user.email}).</span>}
    {user ? <button className="link" onClick={() => signOut(auth)}>로그아웃</button> : <button className="link" onClick={login}>관리자 로그인</button>}
    <Notice tone="error">{error}</Notice>
  </div>
}

function App() {
  const { user, isOwner } = useOwner()
  if (!firebaseReady) return <Notice tone="error">Firebase 설정값이 없어 사진첩과 질문 게시판을 열 수 없습니다. Vercel 환경 변수(VITE_FIREBASE_…)를 확인해 주세요.</Notice>
  return <>
    <Gallery isOwner={isOwner}/>
    <QnA isOwner={isOwner}/>
    <OwnerBar user={user} isOwner={isOwner}/>
  </>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
