import { v4 as uuidv4 } from "uuid";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import OldMessage from "../../models/OldMessage";
import Ticket from "../../models/Ticket";
import User from "../../models/User";

/**
 * Linhares: nota interna na conversa. Fica so no banco (nunca passa pelo
 * WhatsApp), nao mexe no ticket (ultima mensagem, nao lidas, status) e o
 * evento vai so para a sala do ticket, isto e, para quem esta com a conversa
 * aberta.
 */

const loadNote = (id: string, ticketId: number) =>
  Message.findOne({
    where: { id, ticketId },
    include: [
      "contact",
      { model: User, as: "user", attributes: ["id", "name"] },
      {
        model: Ticket,
        as: "ticket",
        include: ["contact", "queue", "user", "tags"]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"],
        required: false
      },
      {
        model: OldMessage,
        as: "oldMessages",
        where: { ticketId },
        required: false
      }
    ]
  });

const emitNote = (message: Message, action: "create" | "update") => {
  getIO()
    .to(message.ticketId.toString())
    .emit(`company-${message.companyId}-appMessage`, {
      action,
      message,
      ticket: message.ticket,
      contact: message.ticket?.contact
    });
};

const checkAuthor = (message: Message, userId: number, profile: string) => {
  if (!message.isPrivate) {
    throw new AppError("ERR_NOT_A_PRIVATE_NOTE", 400);
  }
  if (profile !== "admin" && message.userId !== userId) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
};

interface CreateRequest {
  ticket: Ticket;
  body: string;
  userId: number;
  quotedMsgId?: string;
}

export const CreatePrivateNoteService = async ({
  ticket,
  body,
  userId,
  quotedMsgId
}: CreateRequest): Promise<Message> => {
  const text = (body || "").trim();
  if (!text) {
    throw new AppError("ERR_EMPTY_PRIVATE_NOTE", 400);
  }

  let quotedId: string = null;
  if (quotedMsgId) {
    const quoted = await Message.findOne({
      where: { id: quotedMsgId, ticketId: ticket.id },
      attributes: ["id"]
    });
    quotedId = quoted?.id || null;
  }

  const id = `NOTE-${uuidv4().toUpperCase()}`;

  await Message.create({
    id,
    ticketId: ticket.id,
    companyId: ticket.companyId,
    queueId: ticket.queueId,
    channel: ticket.channel,
    body: text,
    fromMe: true,
    read: true,
    ack: 0,
    mediaType: "conversation",
    isPrivate: true,
    userId,
    quotedMsgId: quotedId
  });

  const message = await loadNote(id, ticket.id);
  emitNote(message, "create");
  return message;
};

interface ChangeRequest {
  message: Message;
  userId: number;
  profile: string;
}

export const EditPrivateNoteService = async ({
  message,
  userId,
  profile,
  body
}: ChangeRequest & { body: string }): Promise<Message> => {
  checkAuthor(message, userId, profile);

  const text = (body || "").trim();
  if (!text) {
    throw new AppError("ERR_EMPTY_PRIVATE_NOTE", 400);
  }

  await OldMessage.upsert({
    messageId: message.id,
    body: message.body,
    ticketId: message.ticketId
  });
  await message.update({ body: text, isEdited: true });

  const saved = await loadNote(message.id, message.ticketId);
  emitNote(saved, "update");
  return saved;
};

export const DeletePrivateNoteService = async ({
  message,
  userId,
  profile
}: ChangeRequest): Promise<Message> => {
  checkAuthor(message, userId, profile);

  await message.update({ isDeleted: true });

  const saved = await loadNote(message.id, message.ticketId);
  emitNote(saved, "update");
  return saved;
};
