import notificationModel from "../models/notifications.model.js"

async function listNotifications(req, res) {
    try {
        const [notifications, unreadCount] = await Promise.all([
            notificationModel.find({ recipient: req.user._id })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean(),
            notificationModel.countDocuments({ recipient: req.user._id, isRead: false })
        ])
        return res.json({ notifications, unreadCount })
    } catch (error) {
        console.error("Could not load notifications:", error)
        return res.status(500).json({ message: "Could not load notifications" })
    }
}

async function markNotificationRead(req, res) {
    try {
        const notification = await notificationModel.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id, isRead: false },
            { $set: { isRead: true } },
            { new: true }
        )
        if (!notification) {
            return res.status(404).json({ message: "Unread notification not found" })
        }
        return res.json({ notification })
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({ message: "Notification not found" })
        }
        console.error("Could not mark notification as read:", error)
        return res.status(500).json({ message: "Could not update notification" })
    }
}

async function markAllNotificationsRead(req, res) {
    try {
        const result = await notificationModel.updateMany(
            { recipient: req.user._id, isRead: false },
            { $set: { isRead: true } }
        )
        return res.json({ updated: result.modifiedCount })
    } catch (error) {
        console.error("Could not mark notifications as read:", error)
        return res.status(500).json({ message: "Could not update notifications" })
    }
}

export { listNotifications, markNotificationRead, markAllNotificationsRead }
