import React, { useState, useEffect, useContext } from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import DialogContentText from "@material-ui/core/DialogContentText";
import DialogTitle from "@material-ui/core/DialogTitle";
import { format } from "date-fns";
import { i18n } from "../../translate/i18n";
import api from "../../services/api";
import ButtonWithSpinner from "../ButtonWithSpinner";
import ContactModal from "../ContactModal";
import toastError from "../../errors/toastError";
import { AuthContext } from "../../context/Auth/AuthContext";
import { WhatsAppsContext } from "../../context/WhatsApp/WhatsAppsContext";
import {
  Grid,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  FormControl,
  InputLabel
} from "@material-ui/core";
import { toast } from "react-toastify";
import { ContactSelect } from "../ContactSelect";

const noEscape = { interpolation: { escapeValue: false } };
const LAST_WHATSAPP_KEY = "linharesNewTicketWhatsappId";

const NewTicketModal = ({ modalOpen, onClose, contact }) => {
  const [selectedContact, setSelectedContact] = useState(null);
  const [forcedContact, setForcedContact] = useState(null);
  const [selectedQueue, setSelectedQueue] = useState("");
  const [newContact, setNewContact] = useState({});
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Linhares: contato ja esta com outro atendente ou aguardando numa fila
  const [blocked, setBlocked] = useState(null);
  const { user } = useContext(AuthContext);
  // Linhares: conexao (numero de saida) da nova conversa
  const { whatsApps } = useContext(WhatsAppsContext);
  const [selectedWhatsapp, setSelectedWhatsapp] = useState("");
  const connections = (whatsApps || []).filter(
    w => w.status === "CONNECTED" && (!w.channel || w.channel === "whatsapp")
  );

  useEffect(() => {
    if (contact) {
      setForcedContact(contact);
      setSelectedContact(contact);
    }
  }, [contact]);

  useEffect(() => {
    setSelectedQueue("");
    setBlocked(null);
    if (!modalOpen) return;
    let lastUsed = null;
    try {
      lastUsed = Number(localStorage.getItem(LAST_WHATSAPP_KEY)) || null;
    } catch (e) {
      lastUsed = null;
    }
    const preferred =
      connections.find(w => w.id === lastUsed) ||
      connections.find(w => w.isDefault) ||
      connections[0];
    setSelectedWhatsapp(preferred ? preferred.id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, whatsApps]);

  const handleClose = () => {
    onClose();
    setSelectedContact(null);
    setBlocked(null);
  };

  const handleSaveTicket = async contactId => {
    if (!contactId) return;
    if (selectedQueue === "" && user.profile !== "admin") {
      toast.error("Selecione uma fila");
      return;
    }
    setLoading(true);
    try {
      const queueId = selectedQueue !== "" ? selectedQueue : null;
      const whatsappId = selectedWhatsapp !== "" ? selectedWhatsapp : null;
      const { data: ticket } = await api.post("/tickets", {
        contactId: contactId,
        queueId,
        userId: user.id,
        status: "open",
        whatsappId
      });
      if (whatsappId) {
        try {
          localStorage.setItem(LAST_WHATSAPP_KEY, String(whatsappId));
        } catch (e) {
          // armazenamento indisponivel: segue sem lembrar a escolha
        }
      }
      onClose(ticket);
    } catch (err) {
      const response = err?.response?.data;
      if (response?.error === "ERR_OTHER_OPEN_TICKET" && response?.data) {
        setBlocked(response.data);
      } else {
        toastError(err);
      }
    }
    setLoading(false);
  };

  const isAdmin = user.profile === "admin";

  const canAccept =
    !!blocked &&
    blocked.status === "pending" &&
    (isAdmin ||
      (!!blocked.queueId &&
        (user.queues || []).some(q => q.id === blocked.queueId)));

  const openBlockedTicket = () => {
    const uuid = blocked.uuid;
    setBlocked(null);
    setSelectedContact(null);
    onClose({ uuid });
  };

  const handleAcceptBlocked = async () => {
    setLoading(true);
    try {
      await api.put(`/tickets/${blocked.ticketId}`, {
        status: "open",
        userId: user.id
      });
      openBlockedTicket();
    } catch (err) {
      toastError(err);
    }
    setLoading(false);
  };

  const handleRequestTransfer = async () => {
    setLoading(true);
    try {
      await api.post(`/tickets/${blocked.ticketId}/transfer-request`);
      toast.success(
        blocked.userName
          ? i18n.t("newTicketModal.blocked.requestSent", {
              user: blocked.userName,
              ...noEscape
            })
          : i18n.t("newTicketModal.blocked.requestSentAdmins")
      );
      handleClose();
    } catch (err) {
      toastError(err);
    }
    setLoading(false);
  };

  const blockedSince = () => {
    if (!blocked?.since) return "";
    try {
      return format(new Date(blocked.since), "dd/MM HH:mm");
    } catch (e) {
      return "";
    }
  };

  const blockedContactName =
    blocked?.contactName || forcedContact?.name || i18n.t("common.contact");

  const handleSelectedContact = contactId => {
    if (contactId) {
      setSelectedContact({ id: contactId });
    } else {
      setSelectedContact(null);
    }
  };

  const handleCreateContact = name => {
    setNewContact({ name });
    setContactModalOpen(true);
  };

  const handleCloseContactModal = () => {
    setContactModalOpen(false);
  };

  const handleAddNewContactTicket = contact => {
    setSelectedContact(contact);
  };

  return (
    <>
      <ContactModal
        open={contactModalOpen}
        initialValues={newContact}
        onClose={handleCloseContactModal}
        onSave={handleAddNewContactTicket}
      />
      <Dialog open={!!blocked} onClose={() => setBlocked(null)}>
        <DialogTitle>
          {blocked?.status === "open"
            ? i18n.t("newTicketModal.blocked.titleOpen")
            : i18n.t("newTicketModal.blocked.titlePending")}
        </DialogTitle>
        <DialogContent dividers>
          <DialogContentText>
            {blocked?.status === "open"
              ? i18n.t("newTicketModal.blocked.withUser", {
                  contact: blockedContactName,
                  user: blocked?.userName || "?",
                  since: blockedSince(),
                  ...noEscape
                })
              : i18n.t("newTicketModal.blocked.pending", {
                  contact: blockedContactName,
                  since: blockedSince(),
                  ...noEscape
                })}
          </DialogContentText>
          <DialogContentText>
            {blocked?.queueName
              ? i18n.t("newTicketModal.blocked.queue", {
                  queue: blocked.queueName,
                  ...noEscape
                })
              : i18n.t("newTicketModal.blocked.noQueue")}
            {blocked?.whatsappName
              ? ` · ${i18n.t("newTicketModal.blocked.connection", {
                  connection: blocked.whatsappName,
                  ...noEscape
                })}`
              : ""}
          </DialogContentText>
          <DialogContentText>
            {canAccept
              ? i18n.t("newTicketModal.blocked.hintAccept")
              : i18n.t("newTicketModal.blocked.hintRequest")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setBlocked(null)}
            color="secondary"
            disabled={loading}
            variant="outlined"
          >
            {i18n.t("newTicketModal.blocked.buttons.close")}
          </Button>
          {!canAccept && (
            <ButtonWithSpinner
              variant="outlined"
              color="primary"
              onClick={handleRequestTransfer}
              loading={loading}
            >
              {i18n.t("newTicketModal.blocked.buttons.request")}
            </ButtonWithSpinner>
          )}
          {canAccept && (
            <ButtonWithSpinner
              variant="contained"
              color="primary"
              onClick={handleAcceptBlocked}
              loading={loading}
            >
              {i18n.t("newTicketModal.blocked.buttons.accept")}
            </ButtonWithSpinner>
          )}
          {isAdmin && (
            <Button
              variant={canAccept ? "outlined" : "contained"}
              color="primary"
              onClick={openBlockedTicket}
              disabled={loading}
            >
              {i18n.t("newTicketModal.blocked.buttons.open")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog open={modalOpen && !blocked} onClose={handleClose}>
        <DialogTitle id="form-dialog-title">
          {i18n.t("newTicketModal.title")}
        </DialogTitle>
        <DialogContent dividers>
          <Grid style={{ width: 300 }} container spacing={2}>
            <Grid xs={12} item>
              {forcedContact ? (
                <TextField
                  label={i18n.t("common.contact")}
                  value={`${forcedContact.name} (${forcedContact.number})`}
                  variant="outlined"
                  fullWidth
                  disabled
                  margin="dense"
                />
              ) : (
                <ContactSelect
                  onSelected={handleSelectedContact}
                  allowCreate={true}
                  onCreateContact={handleCreateContact}
                />
              )}
            </Grid>
            <Grid xs={12} item>
              <FormControl fullWidth variant="outlined" margin="dense">
                <InputLabel id="queue-label">
                  {i18n.t("common.queue")}
                </InputLabel>
                <Select
                  fullWidth
                  displayEmpty
                  variant="outlined"
                  margin="dense"
                  value={selectedQueue || ""}
                  label={i18n.t("common.queue")}
                  onChange={e => {
                    setSelectedQueue(e.target.value);
                  }}
                  MenuProps={{
                    anchorOrigin: {
                      vertical: "bottom",
                      horizontal: "left"
                    },
                    transformOrigin: {
                      vertical: "top",
                      horizontal: "left"
                    },
                    getContentAnchorEl: null
                  }}
                  renderValue={() => {
                    if (!selectedQueue) {
                      return;
                    }
                    const queue = user.queues.find(q => q.id === selectedQueue);
                    return queue.name;
                  }}
                >
                  {user.queues?.length > 0 &&
                    user.queues.map((queue, key) => (
                      <MenuItem dense key={key} value={queue.id}>
                        <ListItemText primary={queue.name} />
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            {connections.length > 1 && (
              <Grid xs={12} item>
                <FormControl fullWidth variant="outlined" margin="dense">
                  <InputLabel id="whatsapp-label">
                    {i18n.t("newTicketModal.connection")}
                  </InputLabel>
                  <Select
                    fullWidth
                    variant="outlined"
                    margin="dense"
                    labelId="whatsapp-label"
                    value={selectedWhatsapp || ""}
                    label={i18n.t("newTicketModal.connection")}
                    onChange={e => setSelectedWhatsapp(e.target.value)}
                    MenuProps={{
                      anchorOrigin: {
                        vertical: "bottom",
                        horizontal: "left"
                      },
                      transformOrigin: {
                        vertical: "top",
                        horizontal: "left"
                      },
                      getContentAnchorEl: null
                    }}
                  >
                    {connections.map(w => (
                      <MenuItem dense key={w.id} value={w.id}>
                        <ListItemText
                          primary={w.name}
                          secondary={
                            w.isDefault
                              ? i18n.t("newTicketModal.defaultConnection")
                              : null
                          }
                        />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleClose}
            color="secondary"
            disabled={loading}
            variant="outlined"
          >
            {i18n.t("newTicketModal.buttons.cancel")}
          </Button>
          <ButtonWithSpinner
            variant="contained"
            type="button"
            disabled={!selectedContact}
            onClick={() => handleSaveTicket(selectedContact?.id)}
            color="primary"
            loading={loading}
          >
            {i18n.t("newTicketModal.buttons.ok")}
          </ButtonWithSpinner>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default NewTicketModal;
