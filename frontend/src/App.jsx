import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { GoogleLogin } from "@react-oauth/google"
import gsap from "gsap"

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000"

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || "The request could not be completed")
  return result
}

function displayName(user) {
  return user?.name || user?.username || "there"
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function localTimeKey(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function App({ googleEnabled }) {
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState("login")
  const [form, setForm] = useState({ name: "", email: "", password: "" })
  const [dashboard, setDashboard] = useState(null)
  const [message, setMessage] = useState("")
  const [messageType, setMessageType] = useState("error")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem("carewell-theme") === "dark" ? "dark" : "light")
  const dashboardMotionRoot = useRef(null)
  const authMotionRoot = useRef(null)

  const showMessage = useCallback((text, type = "error") => {
    setMessage(text)
    setMessageType(type)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem("carewell-theme", theme)
  }, [theme])

  function toggleTheme() {
    setTheme(current => current === "light" ? "dark" : "light")
  }

  const loadDashboard = useCallback(async (role = user?.role) => {
    if (!role) return
    if (role === "admin") {
      const [stats, users, appointments] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/users"),
        api("/api/admin/appointments")
      ])
      const result = { ...stats, ...users, ...appointments }
      setDashboard(result)
      return result
    }
    const path = role === "patient" ? "/api/appointments/my" : "/api/appointments/doctor"
    const result = await api(path)
    setDashboard(result)
    return result
  }, [user?.role])

  useLayoutEffect(() => {
    if (!user || !dashboardMotionRoot.current) return undefined
    const media = gsap.matchMedia()
    const context = gsap.context(() => {
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".welcome-heading", { opacity: 0, y: 14, duration: 0.45, ease: "power2.out" })
        gsap.from(".stat-card", { opacity: 0, y: 16, duration: 0.42, stagger: 0.07, delay: 0.05, ease: "power2.out" })
        gsap.from(".panel", { opacity: 0, y: 18, duration: 0.45, stagger: 0.08, delay: 0.08, ease: "power2.out" })
      })
    }, dashboardMotionRoot)
    return () => {
      context.revert()
      media.revert()
    }
  }, [user?.role, Boolean(dashboard)])

  useLayoutEffect(() => {
    if (loading || user || !authMotionRoot.current) return undefined
    const media = gsap.matchMedia()
    const context = gsap.context(() => {
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".story-copy", { opacity: 0, y: 16, duration: 0.55, ease: "power2.out" })
        gsap.from(".auth-card", { opacity: 0, y: 14, duration: 0.45, delay: 0.08, ease: "power2.out" })
      })
    }, authMotionRoot)
    return () => {
      context.revert()
      media.revert()
    }
  }, [loading, user, mode])

  useEffect(() => {
    let active = true
    api("/api/auth/me")
      .then(result => {
        if (active) setUser(result.user)
      })
      .catch(error => {
        if (error.message !== "Please sign in to continue" && active) showMessage(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [showMessage])

  useEffect(() => {
    if (!user) {
      setDashboard(null)
      return
    }
    let active = true
    const refreshDashboard = () => loadDashboard(user.role).catch(error => {
      if (active) showMessage(error.message)
    })
    refreshDashboard()
    const notificationPoll = user.role === "patient" ? window.setInterval(refreshDashboard, 30000) : null
    return () => {
      active = false
      if (notificationPoll !== null) window.clearInterval(notificationPoll)
    }
  }, [user, loadDashboard, showMessage])

  function updateForm(event) {
    setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    try {
      const result = await api(`/api/auth/${mode === "signup" ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(mode === "signup"
          ? { name: form.name.trim(), email: form.email.trim(), password: form.password }
          : { identifier: form.email.trim(), password: form.password })
      })
      setUser(result.user)
      showMessage(mode === "signup" ? "Your patient account is ready." : "Welcome back.", "success")
    } catch (error) {
      showMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function signInWithGoogle(credential) {
    setBusy(true)
    try {
      const result = await api("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential })
      })
      setUser(result.user)
      showMessage("Welcome to the clinic.", "success")
    } catch (error) {
      showMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" })
      setUser(null)
      setDashboard(null)
      setForm({ name: "", email: "", password: "" })
      showMessage("You have been signed out.", "success")
    } catch (error) {
      showMessage(error.message)
    }
  }

  async function refresh() {
    try {
      await loadDashboard(user?.role)
    } catch (error) {
      showMessage(error.message)
    }
  }

  if (loading) {
    return <main className="loading-screen">Loading your clinic workspace…</main>
  }

  if (user) {
    return (
      <main className="clinic-shell">
        <header className="clinic-header">
          <a className="clinic-brand" href="/" aria-label="Carewell clinic home">
            <span className="clinic-brand-mark">+</span>
            <span>carewell<span className="brand-subtitle">CLINIC</span></span>
          </a>
          <div className="header-account">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <div className="account-copy">
              <strong>{displayName(user)}</strong>
              <span>{user.role}</span>
            </div>
            <button type="button" className="button button-quiet" onClick={logout}>Sign out</button>
          </div>
        </header>

        <section className="dashboard-content" ref={dashboardMotionRoot}>
          <div className="welcome-heading">
            <span className="eyebrow">YOUR CARE, IN ONE PLACE</span>
            <h1>{user.role === "admin" ? "Clinic overview" : `Good to see you, ${displayName(user).split(" ")[0]}`}</h1>
            <p>{roleDescription(user.role)}</p>
          </div>

          {message && <p className={`clinic-feedback ${messageType}`} role="status">{message}</p>}

          {user.role === "patient" && (
            <PatientDashboard
              appointments={dashboard?.appointments || []}
              notifications={dashboard?.notifications || []}
              refresh={refresh}
              showMessage={showMessage}
            />
          )}
          {user.role === "doctor" && (
            <DoctorDashboard
              user={user}
              appointments={dashboard?.appointments || []}
              total={dashboard?.total || 0}
              refresh={refresh}
              showMessage={showMessage}
            />
          )}
          {user.role === "admin" && (
            <AdminDashboard
              data={dashboard}
              refresh={refresh}
              showMessage={showMessage}
            />
          )}
        </section>
      </main>
    )
  }

  const signup = mode === "signup"
  return (
    <main className="page-shell clinic-auth" ref={authMotionRoot}>
      <aside className="story-panel">
        <a className="brand" href="/" aria-label="Carewell home">
          <span className="brand-mark">+</span><span>carewell</span>
        </a>
        <div className="story-copy">
          <span className="eyebrow">CARE THAT FITS YOUR LIFE</span>
          <h1>Better care,<br /><em>closer to home.</em></h1>
          <p>Find the right doctor, request an appointment, and keep your care on track.</p>
        </div>
        <div className="story-foot"><span aria-hidden="true">✳</span> Here for your health.</div>
        <div className="orbit orbit-one" aria-hidden="true" />
        <div className="orbit orbit-two" aria-hidden="true" />
      </aside>

      <section className="form-panel" aria-label="Clinic account access">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <a className="mobile-brand" href="/" aria-label="Carewell home">
          <span className="brand-mark">+</span><span>carewell</span>
        </a>
        <div className="auth-card">
          <span className="eyebrow form-eyebrow">CAREWELL CLINIC</span>
          <h2>{signup ? "Create your patient account" : "Welcome back"}</h2>
          <p className="subtitle">{signup ? "Join us to find a doctor and request an appointment." : "Sign in to manage your clinic appointments."}</p>

          <div className="mode-tabs" role="tablist" aria-label="Choose sign in or sign up">
            <button type="button" role="tab" aria-selected={!signup} className={!signup ? "active" : ""}
              onClick={() => { setMode("login"); setMessage("") }}>Sign in</button>
            <button type="button" role="tab" aria-selected={signup} className={signup ? "active" : ""}
              onClick={() => { setMode("signup"); setMessage("") }}>Patient registration</button>
          </div>

          {googleEnabled && (
            <div className="google-wrap" aria-label="Continue with Google">
              <GoogleLogin
                text="continue_with"
                shape="rectangular"
                size="large"
                theme="outline"
                width="360"
                onSuccess={result => result.credential
                  ? signInWithGoogle(result.credential)
                  : showMessage("Google did not return a sign-in credential.")}
                onError={() => showMessage("Google sign-in could not be completed. Please try again.")}
              />
            </div>
          )}

          {googleEnabled && <div className="divider"><span>or continue with email</span></div>}
          <form onSubmit={submit} className="auth-form">
            {signup && (
              <label>
                <span>Full name</span>
                <input name="name" value={form.name} onChange={updateForm} placeholder="Your full name"
                  autoComplete="name" minLength={2} maxLength={80} required />
              </label>
            )}
            <label>
              <span>Email address</span>
              <input name="email" value={form.email} onChange={updateForm}
                placeholder="you@example.com" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" value={form.password} onChange={updateForm}
                placeholder="At least 8 characters" type="password"
                autoComplete={signup ? "new-password" : "current-password"} minLength={8} required />
            </label>
            <button className="submit-button" type="submit" disabled={busy}>
              {busy ? "Please wait…" : signup ? "Create patient account" : "Sign in"} {!busy && <span aria-hidden="true">→</span>}
            </button>
          </form>
          {message && <p className={`feedback visible ${messageType}`} role="status" aria-live="polite">{message}</p>}
          <p className="auth-note">Doctor and administrator accounts are provided by the clinic.</p>
        </div>
        <footer className="form-foot">Thoughtfully made for your health <span aria-hidden="true">✦</span></footer>
      </section>
    </main>
  )
}

function roleDescription(role) {
  if (role === "admin") return "Manage clinic users, doctors, and appointments."
  if (role === "doctor") return "Review appointment requests and manage your schedule."
  return "Find a doctor and keep track of your appointments."
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark"
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      aria-pressed={isDark}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      {isDark ? (
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.7 8.7 0 1 0 20.2 15.3Z" /></svg>
      )}
      <span>{isDark ? "Light" : "Dark"}</span>
    </button>
  )
}

function PatientDashboard({ appointments, notifications, refresh, showMessage }) {
  const [doctors, setDoctors] = useState([])
  const [search, setSearch] = useState("")
  const [specialization, setSpecialization] = useState("")
  const [specializations, setSpecializations] = useState([])
  const [form, setForm] = useState({ doctorId: "", appointmentDate: "", appointmentTime: "", reason: "" })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (search.trim()) params.set("search", search.trim())
      if (specialization) params.set("specialization", specialization)
      api(`/api/doctors?${params}`)
        .then(result => {
          if (!active) return
          setDoctors(result.doctors)
          setSpecializations(result.specializations || [])
        })
        .catch(error => { if (active) showMessage(error.message) })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [search, specialization, showMessage])

  function updateForm(event) {
    setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function book(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const localAppointment = new Date(`${form.appointmentDate}T${form.appointmentTime}`)
      await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({ ...form, timezoneOffsetMinutes: localAppointment.getTimezoneOffset() })
      })
      setForm(current => ({ ...current, appointmentDate: "", appointmentTime: "", reason: "" }))
      showMessage("Appointment request sent. You can track its status below.", "success")
      await refresh()
    } catch (error) {
      showMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(id) {
    try {
      await api(`/api/appointments/${id}/cancel`, { method: "PATCH" })
      showMessage("Appointment request cancelled.", "success")
      await refresh()
    } catch (error) {
      showMessage(error.message)
    }
  }

  async function markNotificationRead(appointmentId) {
    try {
      await api(`/api/appointments/${appointmentId}/notification/read`, { method: "PATCH" })
      await refresh()
    } catch (error) {
      showMessage(error.message)
    }
  }

  const pendingCount = appointments.filter(item => item.status === "pending").length
  const approvedCount = appointments.filter(item => item.status === "approved").length

  return (
    <>
      <section className="stats-grid patient-stats">
        <StatCard label="Total appointments" value={appointments.length} detail="All your visits" />
        <StatCard label="Awaiting response" value={pendingCount} detail="Requests under review" />
        <StatCard label="Confirmed" value={approvedCount} detail="Approved appointments" />
      </section>
      {notifications.length > 0 && (
        <section className="panel notification-panel" aria-label="Appointment updates">
          <div className="section-heading">
            <div><span className="eyebrow">APPOINTMENT UPDATES</span><h2>New appointment updates</h2></div>
            <span className="notification-count">{notifications.length} new</span>
          </div>
          <div className="notification-list">
            {notifications.map(notification => (
              <article className={`notification-item ${notification.status}`} key={notification.appointmentId}>
                <span className="notification-icon" aria-hidden="true">{notification.status === "approved" ? "✓" : "!"}</span>
                <div><strong>{notification.status === "approved" ? "Appointment approved" : "Appointment not approved"}</strong>
                  <p>{notification.message}</p>
                  <small>{new Date(notification.appointmentDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })} · {notification.appointmentTime}</small>
                </div>
                <button type="button" className="text-button" onClick={() => markNotificationRead(notification.appointmentId)}>Mark read</button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <div><span className="eyebrow">YOUR CARE TEAM</span><h2>Find a doctor</h2></div>
          <div className="doctor-filters">
            <select className="filter-select" aria-label="Filter doctors by specialization" value={specialization}
              onChange={event => setSpecialization(event.target.value)}>
              <option value="">All specialties</option>
              {specializations.map(item => <option value={item} key={item}>{item}</option>)}
            </select>
            <span className="result-count">{doctors.length} available</span>
          </div>
        </div>
        <label className="search-field">
          <span className="sr-only">Search doctors by name or specialization</span>
          <span aria-hidden="true">⌕</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or specialization" />
        </label>
        <div className="doctor-grid">
          {doctors.map(doctor => (
            <article className="doctor-card" key={doctor._id}>
              <DoctorAvatar doctor={doctor} />
              <h3>Dr. {displayName(doctor)}</h3>
              <p>{doctor.specialization}</p>
              <span>{doctor.experience} {doctor.experience === 1 ? "year" : "years"} experience</span>
              <button type="button" className="button button-outline"
                onClick={() => setForm(current => ({ ...current, doctorId: doctor._id }))}>
                {form.doctorId === doctor._id ? "Selected" : "Book with doctor"}
              </button>
            </article>
          ))}
          {!doctors.length && <p className="empty-state">No doctors found. Try another name or specialty.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div><span className="eyebrow">REQUEST A VISIT</span><h2>Book an appointment</h2></div>
        </div>
        <form className="clinic-form" onSubmit={book}>
          <label><span>Doctor</span>
            <select name="doctorId" value={form.doctorId} onChange={updateForm} required>
              <option value="">Choose a doctor</option>
              {doctors.map(doctor => <option value={doctor._id} key={doctor._id}>Dr. {displayName(doctor)} · {doctor.specialization}</option>)}
            </select>
          </label>
          <label><span>Date</span><input type="date" name="appointmentDate" min={localDateKey(new Date())} value={form.appointmentDate} onChange={updateForm} required /></label>
          <label><span>Time</span><input type="time" name="appointmentTime" min={form.appointmentDate === localDateKey(new Date()) ? localTimeKey(new Date(Date.now() + 60000)) : undefined} value={form.appointmentTime} onChange={updateForm} required /></label>
          <label className="form-wide"><span>Reason for visit</span><textarea name="reason" value={form.reason} onChange={updateForm} maxLength={1000} rows={3} placeholder="Briefly tell the doctor what you need help with" required /></label>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Sending request…" : "Request appointment"}</button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">YOUR SCHEDULE</span><h2>My appointments</h2></div><span className="result-count">{appointments.length} total</span></div>
        <AppointmentList appointments={appointments} audience="patient" onCancel={cancel} />
      </section>
    </>
  )
}

function DoctorDashboard({ user, appointments, total, refresh, showMessage }) {
  const [busyId, setBusyId] = useState("")
  async function updateStatus(id, status) {
    setBusyId(id)
    try {
      await api(`/api/appointments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      })
      showMessage(`Appointment ${status}.`, "success")
      await refresh()
    } catch (error) {
      showMessage(error.message)
    } finally {
      setBusyId("")
    }
  }

  return (
    <>
      <section className="panel doctor-profile">
        <DoctorAvatar doctor={user} />
        <div>
          <span className="eyebrow">YOUR PROFILE</span>
          <h2>Dr. {displayName(user)}</h2>
          <p>{user.specialization || "Specialization not set"} · {user.experience || 0} years experience</p>
          <small>{user.email}</small>
        </div>
      </section>
      <section className="stats-grid doctor-stats">
        <StatCard label="Total appointments" value={total} detail="Across all statuses" />
        <StatCard label="Pending requests" value={appointments.filter(item => item.status === "pending").length} detail="Waiting for your review" />
      </section>
      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">YOUR SCHEDULE</span><h2>Appointment requests</h2></div></div>
        <AppointmentList appointments={appointments} audience="doctor" busyId={busyId} onStatusChange={updateStatus} />
      </section>
    </>
  )
}

function AdminDashboard({ data, refresh, showMessage }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", specialization: "", experience: "0", profilePicture: "" })
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState("all")
  const [appointmentSearch, setAppointmentSearch] = useState("")
  const users = data?.users || []
  const appointments = data?.appointments || []
  const shownUsers = filter === "all" ? users : users.filter(user => user.role === filter)
  const searchTerm = appointmentSearch.trim().toLocaleLowerCase()
  const shownAppointments = searchTerm
    ? appointments.filter(appointment => (appointment.patient?.name || appointment.patient?.username || "").toLocaleLowerCase().includes(searchTerm))
    : appointments
  const pendingCount = appointments.filter(appointment => appointment.status === "pending").length
  const approvedCount = appointments.filter(appointment => appointment.status === "approved").length

  async function createDoctor(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api("/api/admin/doctors", { method: "POST", body: JSON.stringify({ ...form, experience: Number(form.experience) }) })
      setForm({ name: "", email: "", password: "", specialization: "", experience: "0", profilePicture: "" })
      showMessage("Doctor account created.", "success")
      await refresh()
    } catch (error) {
      showMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(user) {
    try {
      await api(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive })
      })
      showMessage(`${displayName(user)} is now ${user.isActive ? "deactivated" : "active"}.`, "success")
      await refresh()
    } catch (error) {
      showMessage(error.message)
    }
  }

  async function removeUser(user) {
    if (!window.confirm(`Delete ${displayName(user)} and all of their appointments?`)) return
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" })
      showMessage("User and related appointments deleted.", "success")
      await refresh()
    } catch (error) {
      showMessage(error.message)
    }
  }

  return (
    <>
      <section className="stats-grid">
        <StatCard label="Registered patients" value={data?.stats?.patients ?? "—"} detail="Patient accounts" />
        <StatCard label="Doctors" value={data?.stats?.doctors ?? "—"} detail="Clinic care team" />
        <StatCard label="Appointments" value={data?.stats?.appointments ?? "—"} detail="All appointment requests" />
        <StatCard label="Pending requests" value={pendingCount} detail="Awaiting doctor review" />
        <StatCard label="Approved visits" value={approvedCount} detail="Confirmed appointments" />
      </section>

      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">GROW YOUR CARE TEAM</span><h2>Add a doctor</h2></div></div>
        <form className="clinic-form admin-doctor-form" onSubmit={createDoctor}>
          <label><span>Doctor name</span><input name="name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} maxLength={80} required /></label>
          <label><span>Email</span><input name="email" type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} required /></label>
          <label><span>Temporary password</span><input name="password" type="password" minLength={8} value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} required /></label>
          <label><span>Specialization</span><input name="specialization" value={form.specialization} onChange={event => setForm(current => ({ ...current, specialization: event.target.value }))} maxLength={100} required /></label>
          <label><span>Experience (years)</span><input name="experience" type="number" min="0" max="80" step="1" value={form.experience} onChange={event => setForm(current => ({ ...current, experience: event.target.value }))} required /></label>
          <label className="form-wide"><span>Profile picture URL (optional)</span><input name="profilePicture" type="url" placeholder="https://example.com/doctor.jpg" value={form.profilePicture} onChange={event => setForm(current => ({ ...current, profilePicture: event.target.value }))} /></label>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create doctor account"}</button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div><span className="eyebrow">PEOPLE IN YOUR CLINIC</span><h2>Users</h2></div>
          <select className="filter-select" aria-label="Filter users by role" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All roles</option><option value="patient">Patients</option><option value="doctor">Doctors</option><option value="admin">Admins</option>
          </select>
        </div>
        <div className="table-wrap">
          <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Specialty</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{shownUsers.map(user => (
              <tr key={user.id}>
                <td>{displayName(user)}</td><td>{user.email}</td><td className="capitalize">{user.role}</td>
                <td>{user.specialization || "—"}</td><td><span className={`status-pill ${user.isActive ? "active-status" : "inactive-status"}`}>{user.isActive ? "Active" : "Inactive"}</span></td>
                <td>{user.role !== "admin" && <div className="row-actions">
                  <button type="button" className="text-button" onClick={() => toggleActive(user)}>{user.isActive ? "Deactivate" : "Activate"}</button>
                  <button type="button" className="text-button danger-text" onClick={() => removeUser(user)}>Delete</button>
                </div>}</td>
              </tr>
            ))}
            {!shownUsers.length && <tr><td colSpan="6" className="empty-cell">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">CLINIC-WIDE VIEW</span><h2>All appointments</h2></div><span className="result-count">{shownAppointments.length} of {appointments.length}</span></div>
        <label className="search-field appointment-search">
          <span className="sr-only">Search appointments by patient name</span><span aria-hidden="true">⌕</span>
          <input value={appointmentSearch} onChange={event => setAppointmentSearch(event.target.value)} placeholder="Search by patient name" />
        </label>
        <AppointmentList appointments={shownAppointments} audience="admin" />
      </section>
    </>
  )
}

function StatCard({ label, value, detail }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function DoctorAvatar({ doctor }) {
  const [imageFailed, setImageFailed] = useState(false)
  const imageUrl = doctor.profilePicture && !imageFailed ? doctor.profilePicture : ""
  return (
    <div className="doctor-avatar" aria-hidden={!imageUrl} title={displayName(doctor)}>
      {imageUrl
        ? <img src={imageUrl} alt={`Dr. ${displayName(doctor)}`} loading="lazy" onError={() => setImageFailed(true)} />
        : <span aria-hidden="true">{displayName(doctor).slice(0, 1).toUpperCase()}</span>}
    </div>
  )
}

function AppointmentList({ appointments, audience, onCancel, onStatusChange, busyId }) {
  if (!appointments.length) return <p className="empty-state">No appointments to show yet.</p>
  return (
    <div className="appointment-list">
      {appointments.map(appointment => {
        const patient = appointment.patient || {}
        const doctor = appointment.doctor || {}
        const date = appointment.appointmentDate ? new Date(appointment.appointmentDate).toLocaleDateString(undefined, {
          year: "numeric", month: "short", day: "numeric", timeZone: "UTC"
        }) : "Date unavailable"
        return (
          <article className="appointment-row" key={appointment._id}>
            <div className="appointment-date"><strong>{date}</strong><span>{appointment.appointmentTime}</span></div>
            <div className="appointment-details">
              <strong>{audience === "doctor" ? displayName(patient) : `Dr. ${displayName(doctor)}`}</strong>
              <span>{audience === "doctor" ? patient.email || "Patient details unavailable" : doctor.specialization || "Doctor details unavailable"}</span>
              {audience !== "doctor" && <small>Patient: {displayName(patient)}</small>}
              <p>{appointment.reason}</p>
            </div>
            <div className="appointment-actions">
              <span className={`status-pill status-${appointment.status}`}>{appointment.status}</span>
              {audience === "doctor" && appointment.status === "pending" && (
                <div className="row-actions">
                  <button type="button" className="text-button" disabled={busyId === appointment._id}
                    onClick={() => onStatusChange(appointment._id, "approved")}>Approve</button>
                  <button type="button" className="text-button danger-text" disabled={busyId === appointment._id}
                    onClick={() => onStatusChange(appointment._id, "rejected")}>Reject</button>
                </div>
              )}
              {audience === "patient" && appointment.status === "pending" && (
                <button type="button" className="text-button danger-text" onClick={() => onCancel(appointment._id)}>Cancel request</button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default App
