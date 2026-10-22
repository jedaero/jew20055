import { useEffect, useMemo, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { get, limitToLast, orderByChild, query, ref, set, update } from 'firebase/database'
import { ArrowDownToLine, Camera, CircleHelp, LogIn, LogOut, MessageCircle, RefreshCw, Send, ShieldCheck, Upload, X } from 'lucide-react'
import { auth, database, firebaseReady, ownerUid } from './firebase'

const PHOTO_LIMIT = 8
const DATA_URL_LIMIT = 200_000
const MAX_SOURCE_BYTES = 12 * 1024 * 1024

function explainError(error) {
  if (error?.code === 'PERMISSION_DENIED' || error?.code === 'database/permission-denied') return 'Firebase Rules에서 이 작업을 허용하지 않았습니다. database.rules.json을 배포하고 관리자 UID를 설정했는지 확인해 주세요.'
  if (error?.code === 'auth/popup-blocked') return '로그인 팝업이 차단됐습니다. 브라우저에서 팝업을 허용하고 다시 시도해 주세요.'
  if (error?.code?.startsWith('auth/')) return `로그인 오류: ${error.message}`
  if (error?.code?.startsWith('database/')) return `데이터베이스 오류: ${error.message}`
  return error?.message || '요청을 처리하지 못했습니다.'
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일을 선택해 주세요.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('원본 사진은 12MB 이하만 선택할 수 있습니다.')
  const originalUrl = await fileToDataUrl(file)
  const image = new Image()
  image.src = originalUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('이 브라우저에서 사진 압축을 시작할 수 없습니다.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  for (const quality of [0.62, 0.5, 0.4, 0.32]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob) continue
    const dataUrl = await fileToDataUrl(blob)
    if (dataUrl.length <= DATA_URL_LIMIT) return { dataUrl, bytes: blob.size, width: canvas.width, height: canvas.height }
  }
  throw new Error('사진을 150KB 이내로 줄이지 못했습니다. 더 작은 이미지를 선택해 주세요.')
}

function formatDate(timestamp) {
  return timestamp ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(timestamp)) : ''
}

export default function Community() {
  const [photos, setPhotos] = useState([])
  const [questions, setQuestions] = useState([])
  const [user, setUser] = useState(null)
  const [selected, setSelected] = useState(null)
  const [caption, setCaption] = useState('')
  const [photoName, setPhotoName] = useState('')
  const [questionName, setQuestionName] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [replies, setReplies] = useState({})
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  const isOwner = Boolean(user && ownerUid && user.uid === ownerUid)
  const previewUrl = useMemo(() => selected?.dataUrl || '', [selected])

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, setUser)
  }, [])

  const refresh = async () => {
    if (!database) return
    setLoading(true)
    setNotice('')
    try {
      const [photoSnapshot, questionSnapshot] = await Promise.all([
        get(query(ref(database, 'photos'), orderByChild('createdAt'), limitToLast(PHOTO_LIMIT))),
        get(query(ref(database, 'questions'), orderByChild('createdAt'), limitToLast(20))),
      ])
      setPhotos(Object.entries(photoSnapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => b.createdAt - a.createdAt))
      setQuestions(Object.entries(questionSnapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => b.createdAt - a.createdAt))
    } catch (error) {
      setNotice(explainError(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (firebaseReady) refresh() }, [])

  const choosePhoto = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy('compress')
    setNotice('사진을 이 기기에서 먼저 축소하고 있습니다…')
    try {
      const compressed = await compressPhoto(file)
      setSelected({ ...compressed, sourceName: file.name })
      setNotice(`사진을 ${compressed.width}×${compressed.height}, ${(compressed.bytes / 1024).toFixed(0)}KB로 줄였습니다.`)
    } catch (error) {
      setSelected(null)
      setNotice(explainError(error))
    } finally {
      setBusy('')
    }
  }

  const uploadPhoto = async event => {
    event.preventDefault()
    if (!database || !selected) return
    setBusy('photo')
    setNotice('')
    try {
      const slot = `slot-${Date.now() % PHOTO_LIMIT}`
      const item = ref(database, `photos/${slot}`)
      await set(item, { imageData: selected.dataUrl, caption: caption.trim().slice(0, 160), createdAt: Date.now(), author: photoName.trim().slice(0, 40) })
      setSelected(null); setCaption(''); setPhotoName('')
      setNotice('사진을 올렸습니다.')
      await refresh()
    } catch (error) {
      setNotice(explainError(error))
    } finally { setBusy('') }
  }

  const submitQuestion = async event => {
    event.preventDefault()
    if (!database || questionText.trim().length < 2) return
    setBusy('question'); setNotice('')
    try {
      const createdAt = Date.now()
      const slot = `slot-${createdAt % 100}`
      await set(ref(database, `questions/${slot}`), { question: questionText.trim().slice(0, 500), name: questionName.trim().slice(0, 40), createdAt })
      setQuestionText(''); setQuestionName(''); setNotice('질문을 보냈습니다. 답변이 등록되면 여기에 표시됩니다.')
      await refresh()
    } catch (error) { setNotice(explainError(error)) } finally { setBusy('') }
  }

  const login = async () => {
    setBusy('login'); setNotice('')
    try { await signInWithPopup(auth, new GoogleAuthProvider()) } catch (error) { setNotice(explainError(error)) } finally { setBusy('') }
  }

  const answerQuestion = async (event, questionId) => {
    event.preventDefault()
    const answer = (replies[questionId] || '').trim()
    if (!answer || !database) return
    setBusy(questionId); setNotice('')
    try {
      await update(ref(database, `questions/${questionId}`), { answer: answer.slice(0, 1000), answeredAt: Date.now() })
      setReplies(current => ({ ...current, [questionId]: '' })); setNotice('답변을 등록했습니다.'); await refresh()
    } catch (error) { setNotice(explainError(error)) } finally { setBusy('') }
  }

  return <section className="community" id="community">
    <div className="community-heading"><div><div className="section-kicker">COMMUNITY TRANSMISSION</div><h2>사진 & 질문</h2><p>사진을 공유하고 궁금한 점을 남겨 주세요.</p></div><button className="refresh-button" onClick={refresh} disabled={!firebaseReady || loading} aria-label="새로 고침"><RefreshCw size={15} className={loading ? 'spin' : ''}/><span>새로고침</span></button></div>
    {!firebaseReady && <div className="firebase-notice"><ShieldCheck size={17}/><div><b>Firebase 설정이 필요합니다</b><span>.env.local에 웹 앱 설정을 입력한 뒤 Realtime Database Rules를 배포해 주세요. 설정 방법은 README.md에 있습니다.</span></div></div>}
    {notice && <div className="community-notice" role="status">{notice}</div>}

    <div className="community-grid">
      <section className="community-card photo-card"><div className="community-card-title"><span className="community-icon"><Camera size={17}/></span><div><h3>사진 올리기</h3><p>사진은 업로드 전에 기기에서 압축됩니다.</p></div></div>
        <form onSubmit={uploadPhoto} className="community-form">
          {previewUrl ? <div className="photo-preview"><img src={previewUrl} alt="압축된 업로드 미리보기"/><button type="button" className="remove-photo" onClick={()=>setSelected(null)} aria-label="사진 제거"><X size={15}/></button><span>{(selected.bytes/1024).toFixed(0)}KB · 최대 800px</span></div> : <label className="upload-drop"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={!firebaseReady || Boolean(busy)}/><Upload size={22}/><b>{busy === 'compress' ? '사진 압축 중…' : '사진을 선택하세요'}</b><span>JPEG, PNG, WebP · 원본 최대 12MB</span></label>}
          <input className="text-input" value={photoName} maxLength={40} onChange={e=>setPhotoName(e.target.value)} placeholder="이름 (선택)" disabled={!firebaseReady}/>
          <input className="text-input" value={caption} maxLength={160} onChange={e=>setCaption(e.target.value)} placeholder="사진 설명 (선택, 160자)" disabled={!firebaseReady}/>
          <button className="community-submit" type="submit" disabled={!firebaseReady || !selected || busy === 'photo'}><Upload size={15}/>{busy === 'photo' ? '저장 중…' : '압축 사진 올리기'}</button>
        </form>
        <div className="photo-gallery-heading"><h4>최근 사진</h4><span>{photos.length}장 표시</span></div>
        {photos.length ? <div className="photo-grid">{photos.map(photo=><figure key={photo.id}><img src={photo.imageData} loading="lazy" alt={photo.caption || '방문자가 공유한 사진'}/><figcaption>{photo.caption || '사진'}<small>{photo.author ? `${photo.author} · ` : ''}{formatDate(photo.createdAt)}</small></figcaption></figure>)}</div> : <div className="empty-state"><Camera size={20}/><span>아직 공유된 사진이 없습니다.</span></div>}
      </section>

      <section className="community-card qa-card"><div className="community-card-title"><span className="community-icon violet"><CircleHelp size={18}/></span><div><h3>질문 & 답변</h3><p>질문을 남기면 답변이 공개됩니다.</p></div></div>
        <form onSubmit={submitQuestion} className="community-form question-form"><input className="text-input" value={questionName} maxLength={40} onChange={e=>setQuestionName(e.target.value)} placeholder="이름 (선택)" disabled={!firebaseReady}/><textarea className="text-input question-textarea" value={questionText} maxLength={500} onChange={e=>setQuestionText(e.target.value)} placeholder="무엇이 궁금하신가요? (최대 500자)" required minLength={2} disabled={!firebaseReady}/><div className="form-footer"><span>{questionText.length}/500</span><button className="community-submit" type="submit" disabled={!firebaseReady || questionText.trim().length < 2 || busy === 'question'}><Send size={14}/>{busy === 'question' ? '전송 중…' : '질문 보내기'}</button></div></form>
        <div className="qa-list-heading"><h4>최근 질문</h4><span>최대 20개 표시</span></div>
        {questions.length ? <div className="qa-list">{questions.map(item=><article className="qa-item" key={item.id}><div className="qa-question"><MessageCircle size={15}/><div><p>{item.question}</p><small>{item.name ? `${item.name} · ` : ''}{formatDate(item.createdAt)}</small></div></div>{item.answer ? <div className="qa-answer"><b><ShieldCheck size={13}/> 답변</b><p>{item.answer}</p>{item.answeredAt && <small>{formatDate(item.answeredAt)}</small>}</div> : <div className="pending-answer">답변을 기다리는 중</div>}{isOwner && <form className="answer-form" onSubmit={event=>answerQuestion(event,item.id)}><input className="text-input" maxLength={1000} value={replies[item.id] ?? item.answer ?? ''} onChange={e=>setReplies(current=>({...current,[item.id]:e.target.value}))} placeholder="답변 작성 (최대 1,000자)"/><button type="submit" disabled={busy === item.id || !(replies[item.id] || '').trim()} aria-label="답변 저장"><Send size={14}/></button></form>}</article>)}</div> : <div className="empty-state"><MessageCircle size={20}/><span>아직 질문이 없습니다.</span></div>}
        <div className="owner-row">{isOwner ? <><span className="owner-status"><ShieldCheck size={14}/> 관리자 로그인됨</span><button className="text-button" onClick={()=>signOut(auth)}><LogOut size={13}/> 로그아웃</button></> : <><span>관리자만 질문에 답변할 수 있습니다.</span><button className="text-button" onClick={login} disabled={!firebaseReady || !auth || Boolean(busy)}><LogIn size={13}/> 관리자 로그인</button></>}</div>
      </section>
    </div>
    <p className="community-footnote"><ArrowDownToLine size={13}/> 사진은 800px 이하·150KB 안팎으로 압축합니다. 이 페이지는 최근 8장만 읽어 데이터 전송량을 제한합니다.</p>
  </section>
}
