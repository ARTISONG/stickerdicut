import { useStore } from './store'
import { ManageScreen } from './components/ManageScreen'
import { CropStudio } from './components/CropStudio'
import { EditScreen } from './components/EditScreen'
import { ExportScreen } from './components/ExportScreen'

export function App() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  const count = useStore((s) => s.stickers.length)

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="mark">✂</span>
          <span>Dicut</span>
        </div>
        <nav className="nav">
          <button className={screen === 'manage' ? 'active' : ''} onClick={() => setScreen('manage')}>จัดการสติกเกอร์</button>
          <button className={screen === 'edit' ? 'active' : ''} onClick={() => setScreen('edit')}>แก้ไข</button>
          <button className={screen === 'export' ? 'active' : ''} onClick={() => setScreen('export')}>ส่งออก</button>
        </nav>
        <div className="spacer" />
        <div className="help">{count} สติกเกอร์ · ประมวลผลในเบราว์เซอร์ล้วน 🔒</div>
      </header>

      <main className="content">
        {screen === 'manage' && <ManageScreen />}
        {screen === 'crop' && <CropStudio />}
        {screen === 'edit' && <EditScreen />}
        {screen === 'export' && <ExportScreen />}
      </main>
    </div>
  )
}
