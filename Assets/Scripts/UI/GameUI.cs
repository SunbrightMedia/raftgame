/// <summary>
/// One place to ask whether any full-screen UI currently owns the cursor and
/// input. Gameplay scripts check this instead of naming individual panels, so
/// adding another screen later does not mean touching the controller again.
/// </summary>
public static class GameUI
{
    public static bool BlocksGameplay => InventorySystem.IsOpen || DevMenu.IsOpen;
}
