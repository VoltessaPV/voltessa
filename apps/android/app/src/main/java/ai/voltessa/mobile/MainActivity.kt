@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package ai.voltessa.mobile

import ai.voltessa.mobile.data.ApiClient
import ai.voltessa.mobile.data.AuthRepository
import ai.voltessa.mobile.data.AutomationsRepository
import ai.voltessa.mobile.data.MarketRepository
import ai.voltessa.mobile.data.PlantsRepository
import ai.voltessa.mobile.data.TokenStore
import ai.voltessa.mobile.ui.AppScreen
import ai.voltessa.mobile.ui.AppViewModel
import ai.voltessa.mobile.ui.GoogleSignInOutcome
import ai.voltessa.mobile.ui.MainSection
import ai.voltessa.mobile.ui.requestGoogleIdToken
import ai.voltessa.mobile.ui.screens.AlertsScreen
import ai.voltessa.mobile.ui.screens.AutomationsScreen
import ai.voltessa.mobile.ui.screens.BessScreen
import ai.voltessa.mobile.ui.screens.DashboardScreen
import ai.voltessa.mobile.ui.screens.LoginScreen
import ai.voltessa.mobile.ui.screens.MarketScreen
import ai.voltessa.mobile.ui.screens.SettingsScreen
import ai.voltessa.mobile.ui.theme.VoltessaTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import kotlinx.coroutines.launch

private fun sectionLabel(section: MainSection): String = when (section) {
    MainSection.DASHBOARD -> "Dashboard"
    MainSection.MARKET -> "Market"
    MainSection.BESS -> "BESS"
    MainSection.AUTOMATIONS -> "Automations"
    MainSection.ALERTS -> "Alerts"
    MainSection.SETTINGS -> "Settings"
}

class MainActivity : ComponentActivity() {
    private val viewModel: AppViewModel by viewModels {
        object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val tokenStore = TokenStore(applicationContext)
                val apiClient = ApiClient(tokenStore)
                val authRepository = AuthRepository(apiClient, tokenStore)
                val plantsRepository = PlantsRepository(apiClient)
                val marketRepository = MarketRepository(apiClient)
                val automationsRepository = AutomationsRepository(apiClient)

                @Suppress("UNCHECKED_CAST")
                return AppViewModel(authRepository, plantsRepository, marketRepository, automationsRepository) as T
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            VoltessaTheme {
                // Explicit `color` (not the Surface default of colorScheme.surface):
                // this is the page background behind every screen, matching Web's
                // body { background: var(--background) } - cards sit visibly on top
                // of it at their own, lighter colorScheme.surface tone.
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val uiState by viewModel.state.collectAsState()
                    val context = LocalContext.current
                    val loginScope = rememberCoroutineScope()

                    when (uiState.screen) {
                        AppScreen.LOADING -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }

                        AppScreen.LOGIN -> LoginScreen(
                            isBusy = uiState.isBusy,
                            errorMessage = uiState.loginError,
                            onLogin = viewModel::login,
                            onGoogleSignIn = {
                                loginScope.launch {
                                    // M5 - the actual Credential Manager UI runs here,
                                    // anchored to this Activity's context; the
                                    // ViewModel only ever sees the resulting outcome,
                                    // never the Activity itself.
                                    when (val outcome = requestGoogleIdToken(context)) {
                                        is GoogleSignInOutcome.Success -> viewModel.loginWithGoogle(outcome.idToken)
                                        is GoogleSignInOutcome.Cancelled -> Unit
                                        is GoogleSignInOutcome.Failed -> viewModel.onGoogleSignInCancelledOrFailed(outcome.message)
                                    }
                                }
                            },
                        )

                        AppScreen.MAIN -> {
                            // M4.2 - a navigation drawer (not bottom navigation): six
                            // destinations don't fit a bottom bar's labels on a phone
                            // width without wrapping/truncation, and Web's own nav is
                            // itself a persistent side list of the same six items
                            // (AppSidebar.tsx) - a drawer is the direct mobile
                            // equivalent of that same information architecture, not a
                            // different one invented for this app.
                            val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
                            val scope = rememberCoroutineScope()
                            val sections = listOf(
                                MainSection.DASHBOARD,
                                MainSection.MARKET,
                                MainSection.BESS,
                                MainSection.AUTOMATIONS,
                                MainSection.ALERTS,
                                MainSection.SETTINGS,
                            )

                            ModalNavigationDrawer(
                                drawerState = drawerState,
                                drawerContent = {
                                    ModalDrawerSheet {
                                        Text(
                                            text = "Voltessa",
                                            style = MaterialTheme.typography.titleLarge,
                                            modifier = Modifier.padding(16.dp),
                                        )
                                        HorizontalDivider()
                                        sections.forEach { section ->
                                            NavigationDrawerItem(
                                                label = { Text(sectionLabel(section)) },
                                                selected = uiState.mainSection == section,
                                                onClick = {
                                                    viewModel.selectSection(section)
                                                    scope.launch { drawerState.close() }
                                                },
                                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                                            )
                                        }
                                    }
                                },
                            ) {
                                Scaffold(
                                    topBar = {
                                        TopAppBar(
                                            title = { Text(sectionLabel(uiState.mainSection)) },
                                            navigationIcon = {
                                                IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                                    // Plain-text hamburger glyph, not an icon-font
                                                    // dependency - keeps this drawer at zero new
                                                    // dependencies, per the milestone's own constraint.
                                                    Text(text = "≡", style = MaterialTheme.typography.headlineMedium)
                                                }
                                            },
                                        )
                                    },
                                ) { paddingValues ->
                                    Box(modifier = Modifier.fillMaxSize().padding(paddingValues)) {
                                        when (uiState.mainSection) {
                                            MainSection.DASHBOARD -> DashboardScreen(
                                                isBusy = uiState.isBusy,
                                                plants = uiState.plants,
                                                plantsError = uiState.plantsError,
                                                selectedPlant = uiState.selectedPlant,
                                                connection = uiState.connection,
                                                dashboard = uiState.dashboard,
                                                detailError = uiState.detailError,
                                                onSelectPlant = viewModel::selectPlant,
                                                onRefresh = viewModel::openPlants,
                                            )

                                            MainSection.MARKET -> MarketScreen(
                                                isBusy = uiState.marketBusy,
                                                market = uiState.market,
                                                errorMessage = uiState.marketError,
                                                onRefresh = viewModel::loadMarket,
                                            )

                                            MainSection.BESS -> BessScreen()

                                            MainSection.AUTOMATIONS -> AutomationsScreen(
                                                isBusy = uiState.automationsBusy,
                                                settings = uiState.automationSettings,
                                                errorMessage = uiState.automationsError,
                                                saveMessage = uiState.automationsSaveMessage,
                                                onSave = viewModel::saveAutomationSettings,
                                                onRefresh = viewModel::loadAutomationSettings,
                                            )

                                            MainSection.ALERTS -> AlertsScreen()

                                            MainSection.SETTINGS -> uiState.user?.let { user ->
                                                SettingsScreen(user = user, onLogout = viewModel::logout)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
