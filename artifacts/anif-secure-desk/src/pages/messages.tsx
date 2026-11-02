import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowRight, Eye, EyeOff, Headphones, LockKeyhole, Plus, Send, TicketPlus } from 'lucide-react';
import { formatWAT } from '@/lib/itsm';
import { useNow, useStore } from '@/lib/store';
import { LEVEL_LABEL, isOpen, messageTime, nextTicketId, nowIso, priorityTone, statusTone, ticketSla, uid, unreadOf, withTicketEvent } from '@/lib/domain';
import { createIncidentFromMessage, isConvertibleSupportMessage } from '@/lib/message-conversion';
import type { Conversation, Level, Message, Ticket } from '@/lib/types';
import { Avatar, Badge, Button, Field, Modal, SearchBox, Warning, inputCls, textareaCls } from '@/components/kit';
import { PriorityPreview, SlaBar } from '@/components/ticket-parts';

export default function MessagesPage() {
  const { store, setStore, log } = useStore();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [active, setActive] = useState(store.conversations[0]?.id || '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Toutes');
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<{ message: Message; conversation: Conversation } | null>(null);
  const [focusTicket, setFocusTicket] = useState('');
  const [focusMessageId, setFocusMessageId] = useState('');
  const [supportMessageKind, setSupportMessageKind] = useState<'report' | 'instruction'>('report');
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const c = params.get('c');
    const messageId = params.get('m');
    if (c) { setActive(c); setFilter('Toutes'); }
    if (messageId) setFocusMessageId(messageId);
    else if (c) setFocusMessageId('');
    if (c || messageId) setLocation('/messages', { replace: true });
  }, [search, setLocation]);

  const q = query.trim().toLowerCase();
  const filtered = store.conversations.filter(c => (filter === 'Toutes' || c.kind === filter) && (!q || `${c.title} ${c.participants.join(' ')}`.toLowerCase().includes(q) || c.messages.some(m => m.body.toLowerCase().includes(q))));
  const convo = filtered.find(c => c.id === active) ?? filtered[0];
  const msgLen = convo?.messages.length ?? 0;

  useEffect(() => {
    if (!convo || !focusMessageId) return;
    const sourceMessage = convo.messages.find(message => message.id === focusMessageId);
    if (!sourceMessage) return;
    const element = messageListRef.current
      ? Array.from(messageListRef.current.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find(message => message.dataset.messageId === focusMessageId)
      : undefined;
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [convo?.id, convo?.messages, focusMessageId]);

  useEffect(() => {
    if (!convo) return;
    setStore(s => ({ ...s, conversations: s.conversations.map(c => (c.id === convo.id && c.readCount !== c.messages.length ? { ...c, readCount: c.messages.length } : c)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo?.id, msgLen]);

  const linked = useMemo(() => (convo ? store.tickets.filter(t => t.conversationId === convo.id) : []), [store.tickets, convo]);
  const sideTicket = linked.find(t => t.id === focusTicket) ?? linked[0];
  const draft = convo ? store.drafts[convo.id] ?? '' : '';
  const setDraft = (v: string) => convo && setStore(s => ({ ...s, drafts: { ...s.drafts, [convo.id]: v } }));

  const send = (e: FormEvent) => {
    e.preventDefault(); if (!draft.trim() || !convo) return;
    const at = nowIso(); const id = convo.id;
    const isSupport = convo.kind === 'Support';
    const messageId = uid();
    setStore(s => {
      const drafts = { ...s.drafts }; delete drafts[id];
      const message: Message = {
        id: messageId, author: s.profile.name, body: draft.trim(), time: '', at,
        ...(isSupport ? { isInstruction: supportMessageKind === 'instruction' } : {}),
      };
      return { ...s, drafts, conversations: s.conversations.map(c => (c.id === id ? { ...c, messages: [...c.messages, message] } : c)) };
    });
    setSupportMessageKind('report');
    log(`Message envoyé dans la conversation ${id}`, 'Messagerie');
  };
  const toggleRead = (c: Conversation) => {
    const unread = unreadOf(c) > 0;
    setStore(s => ({ ...s, conversations: s.conversations.map(x => (x.id === c.id ? { ...x, readCount: unread ? x.messages.length : Math.max(0, x.messages.length - 1) } : x)) }));
    log(`Conversation ${c.id} marquée comme ${unread ? 'lue' : 'non lue'}`, 'Messagerie');
  };
  const ticketFor = (m: Message) => store.tickets.find(t => t.sourceMessageId === m.id || t.id === m.ticketId);

  return <div className="page-enter"><Warning />
    <div role="note" className="mb-4 rounded-xl border border-[#bfd0d1] bg-[#e8f0ef] px-4 py-3 text-[11px] leading-relaxed text-[#365456] dark:bg-[#24383b] dark:text-[#bdd3d1]"><strong>Messagerie simulée.</strong> Les conversations fictives sont partagées dans le pilote, mais aucun message n’est envoyé à une personne ni à un service externe.</div>
    <div className="panel grid min-h-[650px] overflow-hidden lg:grid-cols-[300px_1fr] 2xl:grid-cols-[300px_1fr_330px]">
      <aside className="border-b border-border lg:border-b-0 lg:border-r"><div className="p-4"><div className="mb-3 flex items-center justify-between"><div><div className="eyebrow">ESPACE DE TRAVAIL</div><h2 className="mt-1 text-[15px] font-semibold">Conversations</h2></div><button data-testid="button-new-conversation" aria-label="Nouvelle conversation" onClick={() => setCreating(true)} className="focus-ring rounded-lg border border-border p-2 hover:bg-muted"><Plus size={16} /></button></div>
        <SearchBox testId="input-search-messages" value={query} onChange={setQuery} placeholder="Conversation ou contenu de message" />
        <div className="mt-3 flex gap-1 overflow-auto">{['Toutes', 'Support', 'Groupe', 'Équipe', 'Comité'].map(f => <button key={f} data-testid={`filter-conv-${f}`} onClick={() => setFilter(f)} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{f}</button>)}</div></div>
        <div className="max-h-[440px] overflow-y-auto lg:max-h-[600px]">{filtered.map(c => { const last = c.messages.at(-1); const u = unreadOf(c); const hits = q ? c.messages.filter(m => m.body.toLowerCase().includes(q)).length : 0; return <button key={c.id} data-testid={`row-conversation-${c.id}`} onClick={() => setActive(c.id)} className={`w-full border-t border-border/70 px-4 py-3.5 text-left hover:bg-muted/60 ${convo?.id === c.id ? 'bg-[#edf3ed] dark:bg-[#263b36]' : ''}`}><div className="flex gap-3">{c.kind === 'Support' ? <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#213b42] text-[#bfe0cf]"><Headphones size={15} /></div> : <Avatar name={c.participants[1] || c.title} />}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div className={`truncate text-[12px] ${u ? 'font-bold' : 'font-semibold'}`}>{c.title}</div><span className="shrink-0 text-[10px] text-muted-foreground">{last ? messageTime(last) : ''}</span></div><div className="mt-1 truncate text-[11px] text-muted-foreground">{last?.body ?? 'Aucun message'}</div><div className="mt-2 flex items-center gap-2"><Badge tone={c.kind === 'Support' ? 'blue' : 'neutral'}>{c.kind}</Badge>{hits > 0 && <span className="text-[10px] text-primary">{hits} message(s) trouvé(s)</span>}{u > 0 && <span data-testid={`badge-unread-${c.id}`} className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">{u}</span>}</div></div></div></button>; })}{filtered.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">Aucune conversation ni message trouvé.</div>}</div>
      </aside>

      {convo ? <section className="flex min-h-[550px] min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">{convo.kind === 'Support' ? <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#213b42] text-[#bfe0cf]"><Headphones size={15} /></div> : <Avatar name={convo.participants[1] || convo.title} />}<div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{convo.title}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{convo.participants.join(' · ')}</div></div><Badge tone={convo.classification === 'Restreint' ? 'amber' : 'green'}>{convo.classification}</Badge><button data-testid="button-toggle-read" onClick={() => toggleRead(convo)} className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted" title="Basculer lu / non lu">{unreadOf(convo) > 0 ? <><Eye size={13} />Marquer lu</> : <><EyeOff size={13} />Marquer non lu</>}</button></div>
        {convo.kind === 'Support' && <div className="border-b border-border bg-[#e1eaf0]/60 px-5 py-2.5 text-[10px] leading-relaxed text-[#3b6177] dark:bg-[#263c4a]/50 dark:text-[#a8c8d8]">Canal support : seuls ses messages peuvent être convertis en incident, après relecture manuelle d’un résumé technique. Aucune anonymisation automatique n’est effectuée.</div>}
        <div ref={messageListRef} className="flex-1 space-y-5 overflow-y-auto bg-[#f7f6f1] p-5 dark:bg-[#172428] md:p-7" data-testid="list-messages">{convo.messages.map(m => {
          const mine = m.author === store.profile.name && !m.system; const t = ticketFor(m); const hit = q && m.body.toLowerCase().includes(q);
          const isSourceMessage = m.id === focusMessageId;
          if (m.system) return <div key={m.id} data-message-id={m.id} data-testid={`message-${m.id}`} className={`flex justify-center rounded-lg ${isSourceMessage ? 'ring-2 ring-[#c88e43]/70 ring-offset-4 ring-offset-[#f7f6f1] dark:ring-offset-[#172428]' : ''}`}><button onClick={() => m.ticketId && setFocusTicket(m.ticketId)} className="max-w-[88%] rounded-full border border-border bg-card px-3.5 py-1.5 text-center text-[10px] text-muted-foreground hover:border-primary/40"><span className="mono mr-1.5">{messageTime(m)}</span>{m.body}</button></div>;
          return <div key={m.id} data-message-id={m.id} data-testid={`message-${m.id}`} className={`flex gap-2.5 rounded-lg ${mine ? 'flex-row-reverse' : ''} ${isSourceMessage ? 'ring-2 ring-[#c88e43]/70 ring-offset-4 ring-offset-[#f7f6f1] dark:ring-offset-[#172428]' : ''}`}><Avatar name={m.author} /><div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}><div className={`mb-1 flex items-baseline gap-2 text-[10px] text-muted-foreground ${mine ? 'justify-end' : ''}`}><span className="font-semibold text-foreground">{m.author}</span><span>{messageTime(m)}</span></div><div className={`rounded-xl px-3.5 py-2.5 text-left text-[12px] leading-relaxed ${hit ? 'ring-2 ring-[#c88e43]/60' : ''} ${mine ? 'rounded-tr-sm bg-[#dcebe2] text-[#274837] dark:bg-[#285143] dark:text-[#e0f0e4]' : 'rounded-tl-sm border border-border bg-card'}`}>{m.body}</div>
            {convo.kind === 'Support' && <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={m.isInstruction ? 'amber' : 'blue'}>{m.isInstruction ? 'Consigne' : 'Signalement'}</Badge>
              {t ? <button data-testid={`button-linked-${m.id}`} onClick={() => setFocusTicket(t.id)} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary hover:underline"><Badge tone={statusTone(t.status)}>{t.id} · {t.status}</Badge></button> : isConvertibleSupportMessage(m) && <button data-testid={`button-convert-${m.id}`} onClick={() => setConverting({ message: m, conversation: convo })} className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"><TicketPlus size={12} />Convertir en incident</button>}
            </div>}
          </div></div>;
        })}{!convo.messages.length && <div className="py-10 text-center text-[11px] text-muted-foreground">Aucun message. Commencez l’échange ci-dessous.</div>}</div>
        <form onSubmit={send} className="border-t border-border p-4"><div className="eyebrow mb-2 flex items-center gap-1.5"><LockKeyhole size={11} />Échange simulé · ne pas saisir de données sensibles</div>
          {convo.kind === 'Support' && <div className="mb-2 max-w-xs"><Field label="Type du message" hint="Une consigne ne peut pas être convertie en incident."><select data-testid="select-support-message-kind" value={supportMessageKind} onChange={e => setSupportMessageKind(e.target.value as 'report' | 'instruction')} className={inputCls}><option value="report">Signalement</option><option value="instruction">Consigne</option></select></Field></div>}
          <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:ring-2 focus-within:ring-primary/25"><textarea data-testid="input-message" rows={2} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }} placeholder="Écrire un message…" className="max-h-28 min-h-[42px] flex-1 resize-y bg-transparent px-2 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground" aria-label="Message" /><Button type="submit" testId="button-send" className="px-3 py-2" disabled={!draft.trim()}><Send size={14} /><span className="hidden sm:inline">Simuler l’envoi</span></Button></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground"><span>{draft ? 'Brouillon temporaire dans cette session' : 'Entrée pour simuler l’envoi · Maj + Entrée pour une nouvelle ligne'}</span><span>Les conversations fictives sont partagées. Aucun message n’est transmis à un destinataire externe.</span></div></form>
      </section> : <div className="grid min-h-[500px] place-items-center text-sm text-muted-foreground">Sélectionnez une conversation.</div>}

      <aside className="border-t border-border p-4 lg:col-span-2 2xl:col-span-1 2xl:border-l 2xl:border-t-0" data-testid="panel-linked-tickets">
        <div className="eyebrow">TICKETS LIÉS À CETTE DISCUSSION</div>
        {!linked.length ? <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-[11px] leading-relaxed text-muted-foreground">{convo?.kind === 'Support' ? 'Aucun ticket encore. Convertissez un message du canal pour suivre ici son état sans quitter la messagerie.' : 'Seul le canal support permet la conversion de messages en incidents.'}</p>
          : <><div className="mt-3 flex flex-wrap gap-1.5">{linked.map(t => <button key={t.id} onClick={() => setFocusTicket(t.id)} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${sideTicket?.id === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{t.id}</button>)}</div>{sideTicket && <SideTicket ticket={sideTicket} />}</>}
      </aside>
    </div>

    {creating && <NewConversation onClose={() => setCreating(false)} onCreate={c => { setStore(s => ({ ...s, conversations: [c, ...s.conversations] })); setActive(c.id); setFilter('Toutes'); setCreating(false); log(`Conversation ${c.id} créée`, 'Messagerie'); }} />}
    {converting && <ConvertDialog message={converting.message} onClose={() => setConverting(null)} onConvert={(title, summary, impact, urgency, serviceId) => {
      const { message, conversation } = converting;
      if (conversation.kind !== 'Support' || !isConvertibleSupportMessage(message) || store.tickets.some(t => t.sourceMessageId === message.id)) { setConverting(null); return; }
      const id = nextTicketId('Incident', store.tickets); const at = nowIso();
      const t = createIncidentFromMessage({ message, conversationId: conversation.id, ticketId: id, title, summary, impact, urgency, serviceId, openedAt: at, actor: store.profile.name });
      setStore(s => {
        if (s.tickets.some(x => x.sourceMessageId === message.id)) return s;
        const next = { ...s, tickets: [t, ...s.tickets], notifications: [{ id: uid(), ticketId: id, title: `Incident ${id} créé depuis le canal support`, body: `${t.priority} · ${title}`, at }, ...s.notifications] };
        return { ...next, conversations: next.conversations.map(c => (c.id === conversation.id ? { ...c, messages: [...c.messages, { id: uid(), author: `Suivi ${id}`, body: `Incident ${id} ouvert en ${t.priority} à partir d’un message du canal.`, time: '', at, system: true, ticketId: id }] } : c)) };
      });
      setFocusTicket(id); setConverting(null);
    }} />}
  </div>;
}

function SideTicket({ ticket }: { ticket: Ticket }) {
  const { setStore, log } = useStore();
  const now = useNow(1000);
  const [text, setText] = useState('');
  const sla = ticketSla(ticket, now);
  return <div className="mt-4 space-y-3" data-testid={`side-ticket-${ticket.id}`}>
    <div className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="mono text-[10px] text-muted-foreground">{ticket.id} · L{ticket.supportLevel}</span><div className="flex gap-1"><Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge><Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge></div></div><div className="mt-1.5 text-[12px] font-semibold leading-snug">{ticket.title}</div><div className="mt-1 text-[10px] text-muted-foreground">Assigné à {ticket.assignee}</div></div>
    {isOpen(ticket) && ticket.status !== 'Résolu' && <><SlaBar label="Prise en charge" openedAt={ticket.openedAt} deadline={sla.deadlines.acknowledgeBy} completedAt={ticket.acknowledgedAt} now={now} /><SlaBar label="Résolution" openedAt={ticket.openedAt} deadline={sla.deadlines.resolveBy} completedAt={ticket.resolvedAt} now={now} /></>}
    <div><div className="eyebrow mb-2">DERNIÈRES ACTIVITÉS</div><ol className="max-h-44 space-y-2 overflow-y-auto">{[...ticket.updates].reverse().slice(0, 5).map((u, i) => <li key={i} className="text-[10px] leading-relaxed"><span className="font-semibold">{u.author}</span> <span className="mono text-muted-foreground">{u.at ? formatWAT(u.at, 'time') : u.time}</span><div className="text-muted-foreground">{u.body}</div></li>)}</ol></div>
    {isOpen(ticket) && <form onSubmit={e => { e.preventDefault(); if (!text.trim()) return; setStore(s => withTicketEvent(s, ticket.id, text.trim(), {}, s.profile.name, true)); log(`Commentaire ajouté au ticket ${ticket.id} depuis la messagerie`, `Ticket ${ticket.id}`); setText(''); }} className="space-y-2"><textarea data-testid="input-side-comment" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Commenter le ticket (visible dans la discussion)" className="w-full rounded-lg border border-border bg-card p-2.5 text-[11px]" /><Button type="submit" disabled={!text.trim()} className="w-full" testId="button-side-comment"><Send size={13} />Ajouter le commentaire</Button></form>}
    <Link href={`/tickets?ticket=${encodeURIComponent(ticket.id)}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">Ouvrir dans Tickets IT <ArrowRight size={12} /></Link>
  </div>;
}

function NewConversation({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Conversation) => void }) {
  const { store } = useStore();
  const [title, setTitle] = useState(''); const [kind, setKind] = useState('Groupe');
  return <Modal title="Nouvelle conversation" description="Conversation fictive de démonstration. Aucun contenu sensible." onClose={onClose}><form onSubmit={e => { e.preventDefault(); if (!title.trim()) return; const max = store.conversations.reduce((m, c) => Math.max(m, Number(c.id.replace(/\D/g, '')) || 0), 204); onCreate({ id: `C-${max + 1}`, title: title.trim(), kind, classification: 'Interne', participants: [store.profile.name, 'Équipe'], readCount: 0, messages: [] }); }} className="space-y-3"><Field label="Nom de la conversation"><input data-testid="input-conversation-title" required autoFocus value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Ex. Coordination opérationnelle" /></Field><Field label="Type"><select value={kind} onChange={e => setKind(e.target.value)} className={inputCls}>{['Groupe', 'Équipe', 'Comité'].map(k => <option key={k}>{k}</option>)}</select></Field><div data-dialog-sticky-actions className="sticky bottom-[-1.25rem] z-10 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-5 pb-5 pt-3"><Button variant="outline" onClick={onClose}>Annuler</Button><Button type="submit" testId="button-submit-conversation"><Plus size={14} />Créer</Button></div></form></Modal>;
}

function ConvertDialog({ message, onClose, onConvert }: { message: Message; onClose: () => void; onConvert: (title: string, summary: string, impact: Level, urgency: Level, serviceId: string) => void }) {
  const { store } = useStore();
  const [title, setTitle] = useState(message.body.split(/[.!?]/)[0].slice(0, 80));
  const [summary, setSummary] = useState(`Signalement du canal support (${messageTime(message)}).\nSymptôme technique : ${message.body}\nPérimètre observé : à préciser.`);
  const [impact, setImpact] = useState<Level>(2); const [urgency, setUrgency] = useState<Level>(2); const [serviceId, setServiceId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  return <Modal wide title="Convertir en incident" description="Relisez et modifiez le résumé technique. Aucune anonymisation automatique : retirez vous-même toute donnée personnelle, d’enquête ou sensible." onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (confirmed && title.trim() && summary.trim()) onConvert(title.trim(), summary.trim(), impact, urgency, serviceId); }} className="space-y-3">
      <div data-testid="conversion-source-message" className="rounded-lg border border-primary/30 bg-muted/50 p-3">
        <div className="eyebrow">MESSAGE SOURCE · {message.id}</div>
        <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{message.author} · {messageTime(message)}</div>
        <p className="mt-1 text-[12px] leading-relaxed">{message.body}</p>
      </div>
      <Field label="Sujet de l’incident"><input data-testid="input-convert-title" required value={title} onChange={e => setTitle(e.target.value)} className={inputCls} /></Field>
      <Field label="Résumé technique relu"><textarea data-testid="input-convert-summary" required rows={5} value={summary} onChange={e => setSummary(e.target.value)} className={textareaCls} /></Field>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Impact"><select value={impact} onChange={e => setImpact(Number(e.target.value) as Level)} className={inputCls}>{([1, 2, 3] as Level[]).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></Field><Field label="Urgence"><select value={urgency} onChange={e => setUrgency(Number(e.target.value) as Level)} className={inputCls}>{([1, 2, 3] as Level[]).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></Field><Field label="Service"><select value={serviceId} onChange={e => setServiceId(e.target.value)} className={inputCls}><option value="">Aucun</option>{store.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></div>
      <PriorityPreview impact={impact} urgency={urgency} />
      <label className="flex items-start gap-2.5 rounded-lg border border-[#d8b875]/70 bg-[#f4ecd9] p-3 text-[11px] text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]"><input data-testid="checkbox-no-sensitive" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5" /><span>J’ai relu ce résumé et je confirme qu’il ne contient aucune donnée personnelle réelle, information d’enquête ou information classifiée.</span></label>
      <div data-dialog-sticky-actions className="sticky bottom-[-1.25rem] z-10 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-5 pb-5 pt-3"><Button variant="outline" onClick={onClose}>Annuler</Button><Button type="submit" disabled={!confirmed} testId="button-submit-convert"><TicketPlus size={14} />Créer l’incident</Button></div>
    </form>
  </Modal>;
}
